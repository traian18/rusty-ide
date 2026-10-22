//! Running a saved workflow (`.rusty/workflows/*.json`) on a bridge session.
//!
//! The session is created from a recipe carrying the workflow document; the
//! frontend subscribes as usual and then calls `harness_start_workflow`
//! instead of sending a prompt. Every agent step runs in an isolated session
//! that shares this session's backend, workspace and tool registry, so the
//! steps' `HostExecuteCall`s and `HostToolCall`s arrive on this session's
//! bridge and are answered by the same frontend run. What the workflow itself
//! reports -- orchestration events, the steps' agent events, the final state
//! -- is forwarded on the same outbound channel as `BridgeEvent::Workflow*`.

use std::sync::Arc;
use std::time::Duration;

use harness_engine::{OrchestrationConfig, OrchestrationRequest, SessionBuilder};
use harness_protocol::commands::PermissionDecision;
use harness_protocol::ids::SessionId;
use harness_runtime::orchestration::{OrchestrationHandle, OrchestrationUpdate};
use serde::Deserialize;
use tokio::sync::{broadcast, mpsc, watch};
use tokio::task::JoinHandle;

use super::catalog::{Catalog, Source};
use super::{BridgeEvent, HarnessState};

/// Registers `document` on a fresh per-session orchestration config and
/// enables it on `builder`, together with every workflow in `catalog` it may
/// run (built-in and saved). Drafts are allowed for both the workflow and
/// the profiles its steps name: the Behaviors canvas creates both as drafts.
pub fn configure(
    builder: SessionBuilder,
    document: serde_json::Value,
    catalog: &Catalog,
) -> Result<(SessionBuilder, (String, u64)), String> {
    // App-owned profiles are available in every project without seeding
    // files; the workspace's own are loaded by the session builder.
    let profiles = harness_engine::ProfilesConfig::default();
    for profile in catalog.profiles_from(Source::Builtin) {
        profiles
            .register_json(profile.clone())
            .map_err(|error| error.to_string())?;
    }
    let config = OrchestrationConfig::default().allow_drafts(true);
    let key = config
        .register_json(document)
        .map_err(|error| error.to_string())?;
    // A workflow another one runs that does not register is left out: the run
    // that needs it is refused with "not registered", which names it.
    for other in catalog.workflow_documents() {
        let same = other["id"].as_str() == Some(key.0.as_str())
            && other["revision"].as_u64() == Some(key.1);
        if !same {
            // Built-ins that do not register would be a bug the tests catch.
            let _ = config.register_json(other.clone());
        }
    }
    Ok((
        builder
            .profiles(profiles)
            .orchestration(config)
            .allow_draft_profiles(true),
        key,
    ))
}

/// A started workflow run: its control handle and the task forwarding its
/// updates to the frontend.
pub struct WorkflowRun {
    handle: Arc<OrchestrationHandle>,
    pump: JoinHandle<()>,
}

impl WorkflowRun {
    /// Cancels the run (propagating to the active step's session) and stops
    /// forwarding.
    pub fn stop(self) {
        self.handle.cancel();
        self.pump.abort();
    }
}

#[derive(Debug, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum WorkflowControl {
    Cancel,
    Pause,
    Resume,
    /// Answers a `PermissionRequested` event from a step's agent.
    ResolvePermission {
        id: String,
        decision: PermissionDecision,
    },
    /// Answers an `input_requested` workflow event (an approval, or what to
    /// do after a failure) with one of the decisions it offered.
    ResolveInput {
        request_id: String,
        decision: String,
        #[serde(default)]
        text: Option<String>,
    },
}

/// How a workflow run is started, chosen by the user at run time.
#[derive(Debug, Default, Clone, Copy, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowStartOptions {
    /// Approval steps that allow it pass without asking.
    #[serde(default)]
    pub auto_approve: bool,
}

const TERMINAL_EVENTS: [&str; 3] = ["run_completed", "run_failed", "run_cancelled"];

/// How long a finished run's watched state is given to catch up with its
/// terminal event.
const TERMINAL_STATE_WAIT: Duration = Duration::from_secs(5);

fn forward_updates(
    mut updates: broadcast::Receiver<OrchestrationUpdate>,
    state: watch::Receiver<harness_engine::OrchestrationRunState>,
    outbound: mpsc::UnboundedSender<BridgeEvent>,
) -> JoinHandle<()> {
    tokio::spawn(async move {
        let mut forwarder = Forwarder { state, outbound };
        while forwarder.forward(updates.recv().await).await {}
    })
}

/// Relays one run's updates to the session's outbound channel, ending with
/// `WorkflowFinished`.
struct Forwarder {
    state: watch::Receiver<harness_engine::OrchestrationRunState>,
    outbound: mpsc::UnboundedSender<BridgeEvent>,
}

impl Forwarder {
    /// Forwards one update. `false` once there is nothing more to forward:
    /// the run finished, or nobody is listening.
    async fn forward(
        &mut self,
        update: Result<OrchestrationUpdate, broadcast::error::RecvError>,
    ) -> bool {
        match update {
            Ok(OrchestrationUpdate::Event(envelope)) => {
                self.forward_event(serde_json::to_value(&envelope).unwrap_or_default())
                    .await
            }
            Ok(OrchestrationUpdate::Agent(correlated)) => {
                self.send(BridgeEvent::WorkflowAgentEvent {
                    node_id: correlated.correlation.node_id.to_string(),
                    attempt: correlated.correlation.attempt,
                    envelope: correlated.envelope,
                })
            }
            Err(broadcast::error::RecvError::Lagged(dropped)) => self.send(BridgeEvent::Gap {
                last_delivered_sequence: None,
                dropped,
            }),
            Err(broadcast::error::RecvError::Closed) => {
                self.finish();
                false
            }
        }
    }

    /// A terminal event is followed by the run's final state.
    async fn forward_event(&mut self, value: serde_json::Value) -> bool {
        let terminal = value["event"]["type"]
            .as_str()
            .is_some_and(|kind| TERMINAL_EVENTS.contains(&kind));
        if !self.send(BridgeEvent::WorkflowEvent(value)) {
            return false;
        }
        if !terminal {
            return true;
        }
        self.await_terminal_state().await;
        self.finish();
        false
    }

    /// The runner publishes an event before it updates the watched state, so
    /// give the state a moment to catch up. If it does not, the state is
    /// reported as it stands.
    async fn await_terminal_state(&mut self) {
        let settled = tokio::time::timeout(
            TERMINAL_STATE_WAIT,
            self.state.wait_for(|state| state.status.is_terminal()),
        )
        .await;
        if !matches!(settled, Ok(Ok(_))) {
            eprintln!(
                "workflow run ended before its state settled; reporting the state as it stands"
            );
        }
    }

    fn finish(&self) {
        let final_state = serde_json::to_value(&*self.state.borrow()).unwrap_or_default();
        self.send(BridgeEvent::WorkflowFinished { state: final_state });
    }

    /// Whether the event was delivered. It is not only once the session's
    /// outbound channel is closed: the session is gone and nobody is left to
    /// tell, so forwarding stops.
    fn send(&self, event: BridgeEvent) -> bool {
        self.outbound.send(event).is_ok()
    }
}

impl HarnessState {
    /// Starts the session's workflow on `input` and returns the run id.
    pub async fn start_workflow(
        &self,
        session_id: SessionId,
        input: serde_json::Value,
    ) -> Result<String, String> {
        self.start_workflow_from_checkpoint(
            session_id,
            input,
            None,
            WorkflowStartOptions::default(),
        )
        .await
    }

    pub async fn start_workflow_from_checkpoint(
        &self,
        session_id: SessionId,
        input: serde_json::Value,
        checkpoint: Option<harness_engine::OrchestrationRunState>,
        options: WorkflowStartOptions,
    ) -> Result<String, String> {
        let (handle, workflow, outbound) = self
            .with_session(&session_id, |entry| {
                (
                    entry.handle.clone(),
                    entry.workflow.clone(),
                    entry.outbound.clone(),
                )
            })
            .ok_or_else(|| "no such session".to_string())?;
        let (id, revision) =
            workflow.ok_or_else(|| "this session was not created with a workflow".to_string())?;
        if self.with_session(&session_id, |entry| {
            entry.workflow_run.lock().unwrap().is_some()
        }) == Some(true)
        {
            return Err("a workflow is already running on this session".to_string());
        }

        let run_id = format!("{id}-{}", uuid_like());
        let guidance = input
            .get("request")
            .and_then(|value| value.as_str())
            .map(str::to_owned)
            .unwrap_or_else(|| input.to_string());
        let request = OrchestrationRequest::exact(run_id.clone(), id, revision, input)
            .with_auto_approve(options.auto_approve);
        let mut run = match checkpoint {
            Some(state) => handle.retry_orchestration(request, state, guidance).await,
            None => handle.start_orchestration(request).await,
        }
        .map_err(|error| error.to_string())?;
        let pump = forward_updates(run.subscribe(), run.watch(), outbound);
        let started = WorkflowRun {
            handle: Arc::new(run),
            pump,
        };
        self.with_session(&session_id, move |entry| {
            *entry.workflow_run.lock().unwrap() = Some(started)
        })
        .ok_or_else(|| "no such session".to_string())?;
        Ok(run_id)
    }

    /// Reconfigures `step_session` -- a workflow step's session delegated
    /// from `session_id` -- from its next model request (a mid-step model
    /// step-up).
    pub async fn configure_step_execution(
        &self,
        session_id: SessionId,
        step_session: SessionId,
        params: harness_protocol::backend::ExecutionParams,
    ) -> Result<(), String> {
        let handle = self
            .with_session(&session_id, |entry| entry.handle.clone())
            .ok_or_else(|| "no such session".to_string())?;
        handle
            .set_delegated_execution_params(step_session, params)
            .await
            .map_err(|error| error.to_string())
    }

    pub async fn workflow_control(
        &self,
        session_id: SessionId,
        control: WorkflowControl,
    ) -> Result<(), String> {
        let handle = self
            .with_session(&session_id, |entry| {
                entry
                    .workflow_run
                    .lock()
                    .unwrap()
                    .as_ref()
                    .map(|run| run.handle.clone())
            })
            .ok_or_else(|| "no such session".to_string())?
            .ok_or_else(|| "no workflow is running on this session".to_string())?;
        let result = match control {
            WorkflowControl::Cancel => {
                handle.cancel();
                Ok(())
            }
            WorkflowControl::Pause => handle.pause().await,
            WorkflowControl::Resume => handle.resume().await,
            WorkflowControl::ResolvePermission { id, decision } => {
                handle.resolve_permission(id, decision).await
            }
            WorkflowControl::ResolveInput {
                request_id,
                decision,
                text,
            } => {
                let response = harness_engine::InputResponse {
                    decision,
                    text,
                    by: harness_engine::Responder::User,
                };
                handle.resolve_input(request_id, response).await
            }
        };
        result.map_err(|error| error.to_string())
    }
}

impl HarnessState {
    /// The run's current state, so the IDE can read finished steps' outputs
    /// while the run is paused or still going. With `after_step` it first
    /// waits (a few seconds at most) for that step to leave its attempt: the
    /// runner publishes an event before it updates the watched state.
    pub async fn workflow_state(
        &self,
        session_id: SessionId,
        after_step: Option<String>,
    ) -> Result<serde_json::Value, String> {
        let handle = self
            .with_session(&session_id, |entry| {
                entry
                    .workflow_run
                    .lock()
                    .unwrap()
                    .as_ref()
                    .map(|run| run.handle.clone())
            })
            .ok_or_else(|| "no such session".to_string())?
            .ok_or_else(|| "no workflow is running on this session".to_string())?;
        let mut watch = handle.watch();
        let settled = async {
            loop {
                let value = serde_json::to_value(&*watch.borrow()).unwrap_or_default();
                let reached = match &after_step {
                    Some(node) => matches!(
                        value["steps"][node.as_str()]["status"].as_str(),
                        Some("succeeded" | "failed" | "skipped" | "cancelled")
                    ),
                    None => true,
                };
                if reached || watch.changed().await.is_err() {
                    return value;
                }
            }
        };
        Ok(tokio::time::timeout(STATE_WAIT, settled)
            .await
            .unwrap_or_else(|_| serde_json::to_value(handle.snapshot()).unwrap_or_default()))
    }
}

/// How long `workflow_state` waits for a step to settle before answering with what it has.
const STATE_WAIT: Duration = Duration::from_secs(3);

/// Short unique suffix for run ids (time-based; runs are per session).
fn uuid_like() -> String {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|elapsed| elapsed.as_nanos())
        .unwrap_or_default();
    format!("{nanos:x}")
}

#[cfg(test)]
mod tests;
