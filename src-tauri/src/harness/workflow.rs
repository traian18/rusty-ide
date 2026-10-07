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
use tokio::sync::{broadcast, mpsc};
use tokio::task::JoinHandle;

use super::{BridgeEvent, HarnessState};

/// The profiles every workspace has without seeding files: the documents the
/// Behaviors tab lists as built-in (`STARTER_PROFILES` in starterFlow.ts), read
/// from the same files. Keep the two lists in step.
const BUILTIN_CATALOG: &str =
    include_str!("../../../src/components/tabs/behaviors/starter/catalog.json");

fn catalog_profiles() -> Vec<serde_json::Value> {
    serde_json::from_str::<serde_json::Value>(BUILTIN_CATALOG).expect("generated catalog")
        ["profiles"]
        .as_array()
        .expect("catalog profiles")
        .clone()
}

/// The built-in profile documents under their `rusty-ide.builtin.` ids.
fn prefixed_builtin_profiles() -> Result<Vec<serde_json::Value>, String> {
    catalog_profiles()
        .into_iter()
        .map(|mut profile| {
            let id = profile["id"]
                .as_str()
                .ok_or("a built-in profile has no id")?
                .to_owned();
            profile["id"] = serde_json::json!(format!("rusty-ide.builtin.{id}"));
            Ok(profile)
        })
        .collect()
}

pub(crate) fn authoring_builtin_profiles() -> Result<Vec<serde_json::Value>, String> {
    let mut profiles = catalog_profiles();
    profiles.extend(prefixed_builtin_profiles()?);
    Ok(profiles)
}

fn builtin_profiles() -> Result<Vec<serde_json::Value>, String> {
    prefixed_builtin_profiles()
}

/// The built-in workflows under their `rusty-ide.builtin.` ids, naming the
/// built-in profiles under theirs (the same renaming `builtinWorkflow` does
/// in starterFlow.ts), so any workflow can run them as subflows.
fn prefixed_builtin_workflows() -> Vec<serde_json::Value> {
    const PREFIX: &str = "rusty-ide.builtin.";
    /// Renames the profile reference at `path` when there is one.
    fn prefix_profile(node: &mut serde_json::Value, path: &[&str]) {
        let mut at = Some(node);
        for key in path {
            at = at.and_then(|value| value.get_mut(*key));
        }
        if let Some(id) = at.and_then(|reference| reference.get_mut("id")) {
            if let Some(name) = id.as_str() {
                *id = serde_json::json!(format!("{PREFIX}{name}"));
            }
        }
    }
    serde_json::from_str::<serde_json::Value>(BUILTIN_CATALOG).expect("generated catalog")
        ["workflows"]
        .as_array()
        .expect("catalog workflows")
        .iter()
        .cloned()
        .map(|mut workflow| {
            let id = workflow["id"].as_str().unwrap_or_default().to_owned();
            workflow["id"] = serde_json::json!(format!("{PREFIX}{id}"));
            for node in workflow["nodes"].as_array_mut().into_iter().flatten() {
                prefix_profile(node, &["config", "profile"]);
                prefix_profile(node, &["config", "task_queue", "review_profile"]);
                prefix_profile(node, &["config", "target", "profile"]);
            }
            workflow
        })
        .collect()
}

/// Registers `document` on a fresh per-session orchestration config and
/// enables it on `builder`, together with the workflows it may run: the
/// built-in ones and `library`. Drafts are allowed for both the workflow and
/// the profiles its steps name: the Behaviors canvas creates both as drafts.
pub fn configure(
    builder: SessionBuilder,
    document: serde_json::Value,
    library: Vec<serde_json::Value>,
) -> Result<(SessionBuilder, (String, u64)), String> {
    // App-owned profiles are available in every project without seeding files.
    let profiles = harness_engine::ProfilesConfig::default();
    for profile in builtin_profiles()? {
        profiles
            .register_json(profile)
            .map_err(|error| error.to_string())?;
    }
    let config = OrchestrationConfig::default().allow_drafts(true);
    let key = config
        .register_json(document)
        .map_err(|error| error.to_string())?;
    // A workflow another one runs that does not register is left out: the run
    // that needs it is refused with "not registered", which names it.
    for other in prefixed_builtin_workflows().into_iter().chain(library) {
        let same = other["id"].as_str() == Some(key.0.as_str())
            && other["revision"].as_u64() == Some(key.1);
        if !same {
            // Built-ins that do not register would be a bug the tests catch.
            let _ = config.register_json(other);
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

fn forward_updates(
    mut updates: broadcast::Receiver<OrchestrationUpdate>,
    mut state: tokio::sync::watch::Receiver<harness_engine::OrchestrationRunState>,
    outbound: mpsc::UnboundedSender<BridgeEvent>,
) -> JoinHandle<()> {
    tokio::spawn(async move {
        loop {
            match updates.recv().await {
                Ok(OrchestrationUpdate::Event(envelope)) => {
                    let value = serde_json::to_value(&envelope).unwrap_or_default();
                    let terminal = value["event"]["type"]
                        .as_str()
                        .is_some_and(|kind| TERMINAL_EVENTS.contains(&kind));
                    if outbound.send(BridgeEvent::WorkflowEvent(value)).is_err() {
                        return;
                    }
                    if terminal {
                        // The runner publishes an event before it updates the
                        // watched state, so give the state a moment to catch up.
                        let _ = tokio::time::timeout(
                            Duration::from_secs(5),
                            state.wait_for(|state| state.status.is_terminal()),
                        )
                        .await;
                        let final_state =
                            serde_json::to_value(&*state.borrow()).unwrap_or_default();
                        let _ = outbound.send(BridgeEvent::WorkflowFinished { state: final_state });
                        return;
                    }
                }
                Ok(OrchestrationUpdate::Agent(correlated)) => {
                    let event = BridgeEvent::WorkflowAgentEvent {
                        node_id: correlated.correlation.node_id.to_string(),
                        attempt: correlated.correlation.attempt,
                        envelope: correlated.envelope,
                    };
                    if outbound.send(event).is_err() {
                        return;
                    }
                }
                Err(broadcast::error::RecvError::Lagged(dropped)) => {
                    let _ = outbound.send(BridgeEvent::Gap {
                        last_delivered_sequence: None,
                        dropped,
                    });
                }
                Err(broadcast::error::RecvError::Closed) => {
                    let final_state = serde_json::to_value(&*state.borrow()).unwrap_or_default();
                    let _ = outbound.send(BridgeEvent::WorkflowFinished { state: final_state });
                    return;
                }
            }
        }
    })
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
mod tests {
    use std::time::Duration;

    use harness_protocol::backend::{ExecutionEvent, ExecutionResult};
    use harness_protocol::ids::{RequestId, ToolCallId};
    use harness_protocol::tools::ToolCall;
    use harness_protocol::usage::{Cost, ModelUsage};
    use serde_json::json;

    use super::super::recipe::SessionRecipe;
    use super::*;

    fn report() -> serde_json::Value {
        json!({ "summary": "done", "status": "completed", "artifacts": [], "claimsToVerify": [] })
    }

    /// The default workflow, with its agent step accepting JSON text: the
    /// host-routed backend has no native structured output.
    fn workflow_document() -> serde_json::Value {
        let mut document = harness_engine::validation::templates().default_workflow;
        document["id"] = json!("ide.flow");
        document["status"] = json!("draft");
        for node in document["nodes"].as_array_mut().unwrap() {
            if node["type"] == "agent" {
                node["config"]["structured_output"] = json!("host_validated_fallback");
            }
        }
        document
    }

    #[tokio::test]
    async fn a_workflow_runs_its_steps_through_the_sessions_host_bridge() {
        let state = HarnessState::new();
        let recipe: SessionRecipe = serde_json::from_value(json!({
            "workspace": { "root": "/tmp", "binding": "host" },
            "integration": "host",
            "host_tools": [{ "name": "read_file", "description": "Read a file" }],
            "workflow": workflow_document(),
        }))
        .unwrap();
        let session_id = state
            .create_session(recipe)
            .await
            .expect("session with a workflow");
        let mut inbox = state.take_inbox(session_id).unwrap();

        let error = state
            .workflow_control(session_id, WorkflowControl::Cancel)
            .await
            .expect_err("nothing is running yet");
        assert!(error.contains("no workflow"), "{error}");
        state
            .start_workflow(session_id, json!({ "request": "go" }))
            .await
            .expect("run starts");

        let mut kinds = Vec::new();
        let mut agent_events = 0;
        let mut turns = 0;
        let mut step_session = None;
        let read_call = ToolCallId::new();
        let final_state = loop {
            let event = tokio::time::timeout(Duration::from_secs(5), inbox.recv())
                .await
                .expect("the run must not stall")
                .expect("the inbox stays open");
            match event {
                // A step's model turn, routed to the IDE like any other.
                // The step's first turn reads a file; its second reports.
                BridgeEvent::HostExecuteCall { call_id, input, .. } => {
                    turns += 1;
                    if turns == 2 {
                        assert_eq!(
                            input["params"]["model"], "stronger-model",
                            "the step-up applies to the step's next turn"
                        );
                    }
                    let request_id = RequestId::new();
                    let (event, finish) = if turns == 1 {
                        let call = ToolCall {
                            id: read_call,
                            name: "read_file".into(),
                            arguments: json!({ "path": "a.rs" }),
                        };
                        (
                            ExecutionEvent::ToolCallRequested { request_id, call },
                            "tool_use",
                        )
                    } else {
                        (
                            ExecutionEvent::TextDelta {
                                request_id,
                                delta: report().to_string(),
                            },
                            "end_turn",
                        )
                    };
                    state
                        .host_execute_event(session_id, &call_id, event)
                        .unwrap();
                    let result = ExecutionResult {
                        request_id,
                        usage: ModelUsage::default(),
                        cost: Cost::default(),
                        finish_reason: finish.into(),
                    };
                    state
                        .host_execute_result(session_id, &call_id, Ok(result))
                        .unwrap();
                }
                // Answered on this session's bridge, but attributed to the
                // step's own session so the IDE can match it to the step's
                // ToolCallRequested.
                BridgeEvent::HostToolCall {
                    call_id,
                    tool,
                    tool_call_id,
                    session_id: caller,
                    ..
                } => {
                    assert_eq!(tool, "read_file");
                    assert_eq!(tool_call_id, Some(read_call.to_string()));
                    let caller = caller.expect("the requesting session is named");
                    assert_ne!(
                        caller,
                        session_id.to_string(),
                        "steps run in their own session"
                    );
                    // What the JEV decision tool does when it steps up.
                    let params = harness_protocol::backend::ExecutionParams {
                        model: Some("stronger-model".into()),
                        ..Default::default()
                    };
                    state
                        .configure_step_execution(session_id, caller.parse().unwrap(), params)
                        .await
                        .expect("the running step is reachable");
                    step_session = Some(caller);
                    state
                        .host_tool_result(
                            session_id,
                            &call_id,
                            Ok(json!({ "content": "fn main() {}" })),
                        )
                        .unwrap();
                }
                BridgeEvent::WorkflowEvent(envelope) => {
                    kinds.push(
                        envelope["event"]["type"]
                            .as_str()
                            .unwrap_or_default()
                            .to_string(),
                    );
                }
                BridgeEvent::WorkflowAgentEvent {
                    node_id, envelope, ..
                } => {
                    assert_eq!(node_id, "execute");
                    if let Some(step) = &step_session {
                        assert_eq!(
                            &envelope.session_id.to_string(),
                            step,
                            "step events carry the same session id"
                        );
                    }
                    agent_events += 1;
                }
                BridgeEvent::WorkflowFinished { state } => break state,
                _ => {}
            }
        };

        assert_eq!(final_state["status"], "completed", "{final_state}");
        assert_eq!(final_state["final_output"], report());
        assert!(kinds.contains(&"step_succeeded".to_string()), "{kinds:?}");
        assert_eq!(kinds.last().map(String::as_str), Some("run_completed"));
        assert!(agent_events > 0, "the step's agent events are forwarded");
        assert!(step_session.is_some(), "the step called its host tool");
        assert_eq!(turns, 2);
        let gone = state
            .configure_step_execution(
                session_id,
                step_session.unwrap().parse().unwrap(),
                Default::default(),
            )
            .await
            .expect_err("a finished step's session is gone");
        assert!(
            gone.contains("unavailable") || gone.contains("not"),
            "{gone}"
        );
        state.close_session(session_id).await.unwrap();
    }

    #[tokio::test]
    async fn invalid_workflows_fail_session_creation() {
        let state = HarnessState::new();
        let recipe: SessionRecipe = serde_json::from_value(json!({
            "workspace": { "root": "/tmp", "binding": "host" },
            "integration": "host",
            "workflow": { "id": "broken" },
        }))
        .unwrap();
        let error = state.create_session(recipe).await.expect_err("rejected");
        assert!(error.contains("orchestration definition"), "{error}");
    }

    // Historical transport/retry fixtures. Active catalog validation below reads the generated manifest.
    const STARTER_WORKFLOW: &str = include_str!(
        "../../../src/components/tabs/behaviors/starter/legacy/before-task-queue/plan-build-verify.workflow.json"
    );

    /// Every other built-in workflow (`starter/legacy/before-task-queue/`), by file name.
    const BUILTIN_WORKFLOWS: [(&str, &str); 14] = [
        ("investigate", include_str!("../../../src/components/tabs/behaviors/starter/legacy/before-task-queue/investigate.workflow.json")),
        ("design", include_str!("../../../src/components/tabs/behaviors/starter/legacy/before-task-queue/design.workflow.json")),
        ("diagnose", include_str!("../../../src/components/tabs/behaviors/starter/legacy/before-task-queue/diagnose.workflow.json")),
        ("implement", include_str!("../../../src/components/tabs/behaviors/starter/legacy/before-task-queue/implement.workflow.json")),
        ("security-audit", include_str!("../../../src/components/tabs/behaviors/starter/legacy/before-task-queue/security-audit.workflow.json")),
        ("check-changes", include_str!("../../../src/components/tabs/behaviors/starter/legacy/before-task-queue/check-changes.workflow.json")),
        ("analyzed-feature", include_str!("../../../src/components/tabs/behaviors/starter/legacy/before-task-queue/analyzed-feature.workflow.json")),
        ("researched-feature", include_str!("../../../src/components/tabs/behaviors/starter/legacy/before-task-queue/researched-feature.workflow.json")),
        ("bug-fix", include_str!("../../../src/components/tabs/behaviors/starter/legacy/before-task-queue/bug-fix.workflow.json")),
        ("careful-change", include_str!("../../../src/components/tabs/behaviors/starter/legacy/before-task-queue/careful-change.workflow.json")),
        ("security-remediation", include_str!("../../../src/components/tabs/behaviors/starter/legacy/before-task-queue/security-remediation.workflow.json")),
        ("refactor", include_str!("../../../src/components/tabs/behaviors/starter/legacy/before-task-queue/refactor.workflow.json")),
        ("optimize-performance", include_str!("../../../src/components/tabs/behaviors/starter/legacy/before-task-queue/optimize-performance.workflow.json")),
        ("documentation", include_str!("../../../src/components/tabs/behaviors/starter/legacy/before-task-queue/documentation.workflow.json")),
    ];

    fn starter(text: &str) -> serde_json::Value {
        serde_json::from_str(text).expect("a starter document is valid JSON")
    }

    /// The starter with only its first slice: Plan, Build, Verify and the gate.
    /// The gate and loop tests are about one round of build and verify, not
    /// about how the work is split.
    fn one_slice(mut document: serde_json::Value) -> serde_json::Value {
        let second = ["build_2", "verify_2", "gate_2"];
        document["nodes"]
            .as_array_mut()
            .unwrap()
            .retain(|node| !second.contains(&node["id"].as_str().unwrap()));
        let edges = document["edges"].as_array_mut().unwrap();
        edges.retain(|edge| {
            !second.contains(&edge["source"].as_str().unwrap())
                && !second.contains(&edge["target"].as_str().unwrap())
        });
        edges.push(json!({"id": "gate-output", "source": "gate", "target": "output", "condition": "on_success"}));
        for node in document["nodes"].as_array_mut().unwrap() {
            if node["id"] == "output" {
                node["config"]["source"]["node_id"] = json!("verify");
            }
        }
        document["output_contract"]["source"]["node_id"] = json!("verify");
        document
    }

    /// The built-in profiles under the plain ids the bundled workflows name.
    fn starter_library() -> Vec<serde_json::Value> {
        catalog_profiles()
    }

    fn builtin_workflows() -> Vec<(String, serde_json::Value)> {
        serde_json::from_str::<serde_json::Value>(BUILTIN_CATALOG).unwrap()["workflows"]
            .as_array()
            .unwrap()
            .iter()
            .map(|w| (w["id"].as_str().unwrap().to_owned(), w.clone()))
            .collect()
    }

    #[test]
    fn every_builtin_profile_is_valid_and_registered_natively() {
        let library = starter_library();
        assert_eq!(library.len(), 12);
        for profile in &library {
            let issues = harness_engine::validation::validate_profile(profile, &library);
            assert!(issues.is_empty(), "{}: {issues:?}", profile["id"]);
        }
        let registered = builtin_profiles().expect("the built-in profiles are valid JSON");
        let ids: Vec<_> = registered
            .iter()
            .map(|profile| profile["id"].as_str().unwrap().to_owned())
            .collect();
        assert!(
            ids.iter().all(|id| id.starts_with("rusty-ide.builtin.")),
            "{ids:?}"
        );
        let profiles = harness_engine::ProfilesConfig::default();
        for profile in registered {
            profiles
                .register_json(profile)
                .expect("a built-in profile registers");
        }
    }

    #[test]
    fn every_builtin_workflow_compiles_without_issues() {
        let library = starter_library();
        let known: Vec<_> = library
            .iter()
            .map(|profile| profile["id"].as_str().unwrap().to_owned())
            .collect();
        let workflows = builtin_workflows();
        assert_eq!(workflows.len(), 15);
        for (name, workflow) in &workflows {
            let issues = harness_engine::validation::validate_orchestration(workflow, &library);
            assert!(issues.is_empty(), "{name}: {issues:?}");
            // Each agent step is a profile-backed step on a profile that ships with the app.
            for node in workflow["nodes"]
                .as_array()
                .unwrap()
                .iter()
                .filter(|node| node["type"] == "agent")
            {
                let profile = node["config"]["profile"]["id"]
                    .as_str()
                    .unwrap_or_else(|| panic!("{name}/{}: no profile", node["id"]));
                assert!(
                    known.iter().any(|id| id == profile),
                    "{name}/{}: unknown profile {profile}",
                    node["id"]
                );
            }
        }
    }

    #[tokio::test]
    async fn builtin_workflows_create_sessions_with_their_builtin_profiles() {
        for (name, workflow) in builtin_workflows() {
            let mut document = workflow;
            for node in document["nodes"].as_array_mut().unwrap() {
                if let Some(id) = node["config"]["profile"]["id"].as_str() {
                    node["config"]["profile"]["id"] = json!(format!("rusty-ide.builtin.{id}"));
                }
            }
            let state = HarnessState::new();
            let recipe: SessionRecipe = serde_json::from_value(json!({
                "workspace": { "root": "/tmp", "binding": "host" },
                "integration": "host",
                "host_tools": [{ "name": "read_file", "description": "Read a file" }],
                "workflow": document,
            }))
            .unwrap();
            let session = state
                .create_session(recipe)
                .await
                .unwrap_or_else(|error| panic!("{name}: {error}"));
            state.close_session(session).await.unwrap();
        }
    }

    /// `host_validated_fallback` would still send the provider's native schema
    /// whenever the integration advertises one (OpenRouter always does), on
    /// every request of a tool-using step -- which Gemini rejects. The starter
    /// flow must keep the schema out of the request; the executor test
    /// `host_validated_steps_never_send_a_native_schema` in rusty-core covers
    /// what that mode does.
    #[test]
    fn the_starter_flow_never_asks_for_a_native_schema() {
        let workflow = starter(STARTER_WORKFLOW);
        let agents: Vec<_> = workflow["nodes"]
            .as_array()
            .unwrap()
            .iter()
            .filter(|node| node["type"] == "agent")
            .collect();
        assert_eq!(
            agents.len(),
            5,
            "plan, then build and verify for each slice"
        );
        for node in agents {
            // Verify returns a verdict the gate reads, and it uses tools, so it
            // is host-validated JSON, never the provider's native schema.
            let verifier = node["id"].as_str().unwrap().starts_with("verify");
            let expected = if verifier { "host_validated" } else { "text" };
            assert_eq!(
                node["config"]["structured_output"], expected,
                "{}",
                node["id"]
            );
        }
    }

    /// Runs the seeded files as a user would get them: profiles loaded from
    /// `.rusty/profiles`, Plan's result handed to Build, and Verify checking
    /// on disk that the file Build claims to have changed exists.
    #[tokio::test]
    async fn the_starter_flow_plans_builds_and_verifies() {
        run_starter_flow(false).await;
    }

    #[tokio::test]
    async fn text_workflow_passes_verbatim_messages_to_build_and_review() {
        run_text_workflow(false).await;
    }

    #[tokio::test]
    async fn failed_workflow_continues_build_on_a_new_session_without_repeating_plan() {
        run_text_workflow(true).await;
    }

    async fn run_text_workflow(inject_failure: bool) {
        let state = HarnessState::new();
        let directory = tempfile::tempdir().unwrap();
        let mut document = one_slice(starter(STARTER_WORKFLOW));
        // No workspace profile files needed for this transport test.
        for node in document["nodes"].as_array_mut().unwrap() {
            if let Some(id) = node["config"]["profile"]["id"].as_str() {
                node["config"]["profile"]["id"] = json!(format!("rusty-ide.builtin.{id}"));
            }
        }
        let recipe = json!({
            "workspace": { "root": directory.path(), "binding": "host" },
            "integration": "host", "workflow": document,
            "host_tools": [
                { "name": "list_files", "description": "List workspace files" },
                { "name": "read_file", "description": "Read a file" },
            ],
        });
        let mut session = state
            .create_session(serde_json::from_value(recipe.clone()).unwrap())
            .await
            .unwrap();
        let mut inbox = state.take_inbox(session).unwrap();
        let request = "Implement the requested feature";
        state
            .start_workflow(session, json!({"request": request}))
            .await
            .unwrap();
        let plan = "## Plan\n1. Preserve `\"quotes\"` and {not JSON}.\n2. Test the change.\n";
        let build =
            "Implemented step 1.\nTests failed: dependency unavailable.\nDo not approve this yet.";
        let summary = "## Verification\nAll checks passed.";
        let review = json!({"verdict": "pass", "summary": summary}).to_string();
        let replies = [plan, build, review.as_str()];
        let mut turn = 0;
        let mut failure_sent = false;
        loop {
            let event = tokio::time::timeout(Duration::from_secs(10), inbox.recv())
                .await
                .unwrap()
                .unwrap();
            match event {
                BridgeEvent::HostExecuteCall { call_id, input, .. } => {
                    if inject_failure && turn == 2 && !failure_sent {
                        failure_sent = true;
                        state
                            .host_execute_result(
                                session,
                                &call_id,
                                Err(harness_protocol::backend::ExecutionError::BackendError {
                                    message: "HTTP 400: tool_use without tool_result".into(),
                                    code: "400".into(),
                                }),
                            )
                            .unwrap();
                        continue;
                    }
                    let prompt = input["messages"]
                        .as_array()
                        .unwrap()
                        .iter()
                        .flat_map(|m| m["content"].as_array().unwrap())
                        .filter_map(|b| b["Text"]["text"].as_str())
                        .collect::<Vec<_>>()
                        .join("\n");
                    assert!(prompt.contains(request));
                    if turn < 4 {
                        assert!(
                            !prompt.contains("JSON Schema"),
                            "Plan and Build are text steps"
                        );
                    }
                    assert!(input["params"]["response_format"].is_null());
                    // A structured step (Verify) is sent its inputs as JSON, so the
                    // same text arrives escaped; text steps get it verbatim.
                    let escaped = |text: &str| {
                        let quoted = serde_json::to_string(text).unwrap();
                        quoted[1..quoted.len() - 1].to_string()
                    };
                    if turn >= 2 {
                        assert!(
                            prompt.contains(plan) || prompt.contains(&escaped(plan)),
                            "Plan arrives intact"
                        );
                    }
                    if turn == 2 || turn == 3 {
                        assert!(prompt.contains(plan), "Plan arrives verbatim in Build");
                    }
                    if turn >= 4 {
                        assert!(
                            prompt.contains(build) || prompt.contains(&escaped(build)),
                            "Build arrives intact, including failure"
                        );
                    }
                    let request_id = RequestId::new();
                    // Verify's completion gate wants inspection evidence: it reads a file.
                    let event = if turn % 2 == 0 {
                        let name = if turn == 0 { "list_files" } else { "read_file" };
                        ExecutionEvent::ToolCallRequested {
                            request_id,
                            call: ToolCall {
                                id: ToolCallId::new(),
                                name: name.into(),
                                arguments: json!({"path": "."}),
                            },
                        }
                    } else {
                        ExecutionEvent::TextDelta {
                            request_id,
                            delta: replies[turn / 2].into(),
                        }
                    };
                    state.host_execute_event(session, &call_id, event).unwrap();
                    state
                        .host_execute_result(
                            session,
                            &call_id,
                            Ok(ExecutionResult {
                                request_id,
                                usage: ModelUsage::default(),
                                cost: Cost::default(),
                                finish_reason: if turn % 2 == 0 {
                                    "tool_use".into()
                                } else {
                                    "end_turn".into()
                                },
                            }),
                        )
                        .unwrap();
                    turn += 1;
                }
                BridgeEvent::HostToolCall { call_id, .. } => {
                    state
                        .host_tool_result(session, &call_id, Ok(json!({"files": []})))
                        .unwrap();
                }
                BridgeEvent::WorkflowFinished { state: checkpoint } => {
                    if checkpoint["status"] == "failed" && inject_failure {
                        assert_eq!(checkpoint["failed_step"], "build");
                        assert_eq!(turn, 2, "only Plan finished before the failure");
                        state.close_session(session).await.unwrap();
                        session = state
                            .create_session(serde_json::from_value(recipe.clone()).unwrap())
                            .await
                            .unwrap();
                        inbox = state.take_inbox(session).unwrap();
                        state
                            .start_workflow_from_checkpoint(
                                session,
                                json!({"request": "continue"}),
                                Some(serde_json::from_value(checkpoint).unwrap()),
                                WorkflowStartOptions::default(),
                            )
                            .await
                            .unwrap();
                        continue;
                    }
                    assert_eq!(checkpoint["status"], "completed", "{checkpoint}");
                    assert_eq!(
                        checkpoint["final_output"], summary,
                        "the result is Verify's report"
                    );
                    assert_eq!(
                        checkpoint["steps"]["plan"]["attempts"]
                            .as_array()
                            .unwrap()
                            .len(),
                        1
                    );
                    assert_eq!(
                        checkpoint["steps"]["build"]["attempts"]
                            .as_array()
                            .unwrap()
                            .len(),
                        if inject_failure { 2 } else { 1 }
                    );
                    assert_eq!(turn, 6);
                    assert!(!directory.path().join(".rusty/profiles").exists());
                    break;
                }
                _ => {}
            }
        }
        state.close_session(session).await.unwrap();
    }

    /// Every task-queue workflow has a deterministic gate that requires every
    /// planned criterion to be reported; command outcomes alone cannot establish coverage.
    #[test]
    fn editing_workflows_require_task_coverage() {
        for (name, workflow) in builtin_workflows() {
            let nodes = workflow["nodes"].as_array().unwrap();
            if let Some(build) = nodes.iter().find(|n| n["config"]["task_queue"].is_object()) {
                assert_eq!(
                    build["config"]["task_queue"]["plan_pointer"], "/plan",
                    "{name}"
                );
                assert!(
                    nodes
                        .iter()
                        .any(
                            |n| n["config"]["checks"].as_array().is_some_and(|checks| checks
                                .iter()
                                .any(|c| c["type"] == "criteria" && c["plan_pointer"] == "/plan"))
                        ),
                    "{name}"
                );
            }
        }
    }

    #[tokio::test]
    async fn a_failed_verdict_sends_build_back_with_the_findings_until_it_passes() {
        let state = HarnessState::new();
        let directory = tempfile::tempdir().unwrap();
        let mut document = one_slice(starter(STARTER_WORKFLOW));
        for node in document["nodes"].as_array_mut().unwrap() {
            if let Some(id) = node["config"]["profile"]["id"].as_str() {
                node["config"]["profile"]["id"] = json!(format!("rusty-ide.builtin.{id}"));
            }
        }
        let recipe = json!({
            "workspace": { "root": directory.path(), "binding": "host" },
            "integration": "host", "workflow": document,
            "host_tools": [
                { "name": "list_files", "description": "List workspace files" },
                { "name": "read_file", "description": "Read a file" },
            ],
        });
        let session = state
            .create_session(serde_json::from_value(recipe).unwrap())
            .await
            .unwrap();
        let mut inbox = state.take_inbox(session).unwrap();
        state
            .start_workflow(
                session,
                json!({"request": "Implement the requested feature"}),
            )
            .await
            .unwrap();

        let finding = "src/a.ts:3 typecheck error TS2322";
        let failing =
            json!({"verdict": format!("fail: {finding}"), "summary": "Not done."}).to_string();
        let passing =
            json!({"verdict": "pass", "summary": "## Verified\nAll checks passed."}).to_string();
        // Every step is a tool call then a text answer: plan, build, verify (fails), build again, verify (passes).
        let replies = [
            "The plan",
            "Built it",
            failing.as_str(),
            "Fixed it",
            passing.as_str(),
        ];
        let mut turn = 0;
        loop {
            let event = tokio::time::timeout(Duration::from_secs(10), inbox.recv())
                .await
                .unwrap()
                .unwrap();
            match event {
                BridgeEvent::HostExecuteCall { call_id, input, .. } => {
                    let prompt = input["messages"].to_string();
                    if turn == 6 {
                        assert!(
                            prompt.contains("<rejections>"),
                            "Build is told why it is back: {prompt}"
                        );
                        assert!(prompt.contains("verification_failed"), "{prompt}");
                        assert!(
                            prompt.contains("Repair the work before handing it off again"),
                            "Build receives trusted repair guidance: {prompt}"
                        );
                        assert!(
                            prompt.contains(finding),
                            "Build receives the checker's findings: {prompt}"
                        );
                    }
                    if turn == 8 {
                        assert!(
                            prompt.contains("Fixed it"),
                            "the second Verify sees the second Build: {prompt}"
                        );
                    }
                    let request_id = RequestId::new();
                    let event = if turn % 2 == 0 {
                        let name = "read_file";
                        ExecutionEvent::ToolCallRequested {
                            request_id,
                            call: ToolCall {
                                id: ToolCallId::new(),
                                name: name.into(),
                                arguments: json!({"path": "."}),
                            },
                        }
                    } else {
                        ExecutionEvent::TextDelta {
                            request_id,
                            delta: replies[turn / 2].into(),
                        }
                    };
                    state.host_execute_event(session, &call_id, event).unwrap();
                    state
                        .host_execute_result(
                            session,
                            &call_id,
                            Ok(ExecutionResult {
                                request_id,
                                usage: ModelUsage::default(),
                                cost: Cost::default(),
                                finish_reason: if turn % 2 == 0 {
                                    "tool_use".into()
                                } else {
                                    "end_turn".into()
                                },
                            }),
                        )
                        .unwrap();
                    turn += 1;
                }
                BridgeEvent::HostToolCall { call_id, .. } => {
                    state
                        .host_tool_result(session, &call_id, Ok(json!({"files": []})))
                        .unwrap();
                }
                BridgeEvent::WorkflowFinished { state: checkpoint } => {
                    assert_eq!(checkpoint["status"], "completed", "{checkpoint}");
                    let attempts = |step: &str| {
                        checkpoint["steps"][step]["attempts"]
                            .as_array()
                            .unwrap()
                            .len()
                    };
                    assert_eq!(attempts("plan"), 1, "Plan is not repeated");
                    assert_eq!(attempts("build"), 2);
                    assert_eq!(attempts("verify"), 2);
                    assert_eq!(
                        checkpoint["final_output"],
                        "## Verified\nAll checks passed."
                    );
                    assert_eq!(turn, 10);
                    break;
                }
                _ => {}
            }
        }
        state.close_session(session).await.unwrap();
    }

    /// The work is built in two slices, each verified before the next starts: a
    /// failure in the second slice sends only the second Build back, with the
    /// first slice's handoff still in front of it, and the result is the second
    /// Verify's report.
    #[tokio::test]
    async fn a_failure_in_the_second_slice_retries_only_the_second_slice() {
        let state = HarnessState::new();
        let directory = tempfile::tempdir().unwrap();
        let mut document = starter(STARTER_WORKFLOW);
        for node in document["nodes"].as_array_mut().unwrap() {
            if let Some(id) = node["config"]["profile"]["id"].as_str() {
                node["config"]["profile"]["id"] = json!(format!("rusty-ide.builtin.{id}"));
            }
        }
        let recipe = json!({
            "workspace": { "root": directory.path(), "binding": "host" },
            "integration": "host", "workflow": document,
            "host_tools": [
                { "name": "list_files", "description": "List workspace files" },
                { "name": "read_file", "description": "Read a file" },
            ],
        });
        let session = state
            .create_session(serde_json::from_value(recipe).unwrap())
            .await
            .unwrap();
        let mut inbox = state.take_inbox(session).unwrap();
        state
            .start_workflow(
                session,
                json!({"request": "Implement the requested feature"}),
            )
            .await
            .unwrap();

        let finding = "src/b.ts:9 test failed: adds two numbers";
        let pass = json!({"verdict": "pass", "summary": "Slice one verified."}).to_string();
        let failing =
            json!({"verdict": format!("fail: {finding}"), "summary": "Not done."}).to_string();
        let done =
            json!({"verdict": "pass", "summary": "## Verified\nBoth slices pass."}).to_string();
        // Every step is a tool call then a text answer: plan, build, verify, build 2, verify 2 (fails),
        // build 2 again, verify 2 (passes).
        let replies = [
            "## Slice 1\n1. a.ts\n## Slice 2\n2. b.ts",
            "Built slice one",
            pass.as_str(),
            "Built slice two",
            failing.as_str(),
            "Fixed slice two",
            done.as_str(),
        ];
        let mut turn = 0;
        loop {
            let event = tokio::time::timeout(Duration::from_secs(10), inbox.recv())
                .await
                .unwrap()
                .unwrap();
            match event {
                BridgeEvent::HostExecuteCall { call_id, input, .. } => {
                    let prompt = input["messages"].to_string();
                    if turn == 6 {
                        assert!(
                            prompt.contains("Built slice one"),
                            "Build part 2 starts from the first slice: {prompt}"
                        );
                        assert!(!prompt.contains("<rejections>"), "{prompt}");
                    }
                    if turn == 10 {
                        assert!(
                            prompt.contains("<rejections>"),
                            "Build part 2 is told why it is back: {prompt}"
                        );
                        assert!(
                            prompt.contains(finding),
                            "it receives the checker's findings: {prompt}"
                        );
                        assert!(
                            prompt.contains("Built slice one"),
                            "and still has the first slice: {prompt}"
                        );
                    }
                    let request_id = RequestId::new();
                    let event = if turn % 2 == 0 {
                        let name = "read_file";
                        ExecutionEvent::ToolCallRequested {
                            request_id,
                            call: ToolCall {
                                id: ToolCallId::new(),
                                name: name.into(),
                                arguments: json!({"path": "."}),
                            },
                        }
                    } else {
                        ExecutionEvent::TextDelta {
                            request_id,
                            delta: replies[turn / 2].into(),
                        }
                    };
                    state.host_execute_event(session, &call_id, event).unwrap();
                    state
                        .host_execute_result(
                            session,
                            &call_id,
                            Ok(ExecutionResult {
                                request_id,
                                usage: ModelUsage::default(),
                                cost: Cost::default(),
                                finish_reason: if turn % 2 == 0 {
                                    "tool_use".into()
                                } else {
                                    "end_turn".into()
                                },
                            }),
                        )
                        .unwrap();
                    turn += 1;
                }
                BridgeEvent::HostToolCall { call_id, .. } => {
                    state
                        .host_tool_result(session, &call_id, Ok(json!({"files": []})))
                        .unwrap();
                }
                BridgeEvent::WorkflowFinished { state: checkpoint } => {
                    assert_eq!(checkpoint["status"], "completed", "{checkpoint}");
                    let attempts = |step: &str| {
                        checkpoint["steps"][step]["attempts"]
                            .as_array()
                            .unwrap()
                            .len()
                    };
                    assert_eq!(attempts("plan"), 1, "Plan is not repeated");
                    assert_eq!(attempts("build"), 1, "slice one is not rebuilt");
                    assert_eq!(attempts("verify"), 1, "nor re-verified");
                    assert_eq!(attempts("build_2"), 2);
                    assert_eq!(attempts("verify_2"), 2);
                    assert_eq!(checkpoint["final_output"], "## Verified\nBoth slices pass.");
                    assert_eq!(turn, 14);
                    break;
                }
                _ => {}
            }
        }
        state.close_session(session).await.unwrap();
    }

    /// A stage workflow end to end: the earlier result reaches the first step as
    /// `context`, the first step's written handoff reaches the second, and the
    /// read-only profiles are never offered a tool that edits or runs.
    #[tokio::test]
    async fn a_stage_workflow_passes_context_and_handoffs_between_profiles() {
        let mut document = starter(
            BUILTIN_WORKFLOWS
                .iter()
                .find(|(name, _)| *name == "investigate")
                .unwrap()
                .1,
        );
        for node in document["nodes"].as_array_mut().unwrap() {
            if let Some(id) = node["config"]["profile"]["id"].as_str() {
                node["config"]["profile"]["id"] = json!(format!("rusty-ide.builtin.{id}"));
            }
        }
        let state = HarnessState::new();
        let recipe: SessionRecipe = serde_json::from_value(json!({
            "workspace": { "root": "/tmp", "binding": "host" },
            "integration": "host",
            "host_tools": [
                { "name": "read_file", "description": "Read a file" },
                { "name": "write_file", "description": "Write a file" },
                { "name": "run_command", "description": "Run a command" },
            ],
            "workflow": document,
        }))
        .unwrap();
        let session = state
            .create_session(recipe)
            .await
            .expect("session with a stage workflow");
        let mut inbox = state.take_inbox(session).unwrap();
        state
            .start_workflow(
                session,
                json!({ "request": "how does sync work", "context": "EARLIER-RESULT" }),
            )
            .await
            .expect("run starts");

        let brief = "## Brief\nUse the queue.";
        let analysis = "## Analysis\nThe queue lives in sync.rs.";
        let mut prompts = Vec::new();
        let mut offered = Vec::new();
        let mut turn = 0;
        let final_state = loop {
            let event = tokio::time::timeout(Duration::from_secs(10), inbox.recv())
                .await
                .unwrap()
                .unwrap();
            match event {
                BridgeEvent::HostExecuteCall { call_id, input, .. } => {
                    prompts.push(
                        input["messages"]
                            .as_array()
                            .unwrap()
                            .iter()
                            .flat_map(|message| message["content"].as_array().unwrap())
                            .filter_map(|block| block["Text"]["text"].as_str())
                            .collect::<Vec<_>>()
                            .join("\n"),
                    );
                    offered.push(input["tools"].to_string());
                    let request_id = RequestId::new();
                    // Each step reads a file (its completion gate), then writes its handoff.
                    let (event, finish) = if turn % 2 == 0 {
                        let call = ToolCall {
                            id: ToolCallId::new(),
                            name: "read_file".into(),
                            arguments: json!({"path": "a.rs"}),
                        };
                        (
                            ExecutionEvent::ToolCallRequested { request_id, call },
                            "tool_use",
                        )
                    } else {
                        let text = if turn == 1 { brief } else { analysis };
                        (
                            ExecutionEvent::TextDelta {
                                request_id,
                                delta: text.into(),
                            },
                            "end_turn",
                        )
                    };
                    state.host_execute_event(session, &call_id, event).unwrap();
                    state
                        .host_execute_result(
                            session,
                            &call_id,
                            Ok(ExecutionResult {
                                request_id,
                                usage: ModelUsage::default(),
                                cost: Cost::default(),
                                finish_reason: finish.into(),
                            }),
                        )
                        .unwrap();
                    turn += 1;
                }
                BridgeEvent::HostToolCall { call_id, .. } => {
                    state
                        .host_tool_result(
                            session,
                            &call_id,
                            Ok(json!({ "content": "fn main() {}" })),
                        )
                        .unwrap();
                }
                BridgeEvent::WorkflowFinished { state } => break state,
                _ => {}
            }
        };

        assert_eq!(final_state["status"], "completed", "{final_state}");
        assert_eq!(final_state["final_output"], analysis);
        assert_eq!(turn, 4, "two steps of a read and a reply each");
        assert!(
            prompts[0].contains("EARLIER-RESULT"),
            "Research receives the earlier result as context"
        );
        assert!(prompts[0].contains("how does sync work"));
        assert!(
            prompts[2].contains(brief),
            "Analyze receives Research's handoff verbatim"
        );
        for tools in &offered {
            assert!(tools.contains("read_file"), "{tools}");
            assert!(
                !tools.contains("write_file") && !tools.contains("run_command"),
                "read-only profiles are not offered edit or run tools: {tools}"
            );
        }
        state.close_session(session).await.unwrap();
    }

    /// A started stage run whose model turns the caller answers one at a time.
    struct StageRun {
        state: HarnessState,
        session: SessionId,
        inbox: tokio::sync::mpsc::UnboundedReceiver<BridgeEvent>,
        turn: usize,
    }

    const BRIEF: &str = "## Brief\nUse the queue.";
    const ANALYSIS: &str = "## Analysis\nThe queue lives in sync.rs.";

    async fn start_investigate() -> StageRun {
        let mut document = starter(
            BUILTIN_WORKFLOWS
                .iter()
                .find(|(name, _)| *name == "investigate")
                .unwrap()
                .1,
        );
        for node in document["nodes"].as_array_mut().unwrap() {
            if let Some(id) = node["config"]["profile"]["id"].as_str() {
                node["config"]["profile"]["id"] = json!(format!("rusty-ide.builtin.{id}"));
            }
        }
        let state = HarnessState::new();
        let recipe: SessionRecipe = serde_json::from_value(json!({
            "workspace": { "root": "/tmp", "binding": "host" },
            "integration": "host",
            "host_tools": [{ "name": "read_file", "description": "Read a file" }],
            "workflow": document,
        }))
        .unwrap();
        let session = state.create_session(recipe).await.expect("session");
        let inbox = state.take_inbox(session).unwrap();
        state
            .start_workflow(
                session,
                json!({ "request": "how does sync work", "context": "" }),
            )
            .await
            .expect("run starts");
        StageRun {
            state,
            session,
            inbox,
            turn: 0,
        }
    }

    impl StageRun {
        /// Answers model turns until `stop` says the events so far are enough, or the
        /// run goes quiet for `quiet`. Each step reads a file, then writes its handoff.
        async fn pump(
            &mut self,
            quiet: Duration,
            mut stop: impl FnMut(&BridgeEvent) -> bool,
        ) -> Vec<BridgeEvent> {
            let mut seen = Vec::new();
            while let Ok(Some(event)) = tokio::time::timeout(quiet, self.inbox.recv()).await {
                match &event {
                    BridgeEvent::HostExecuteCall { call_id, .. } => {
                        let request_id = RequestId::new();
                        let (event, finish) = if self.turn.is_multiple_of(2) {
                            let call = ToolCall {
                                id: ToolCallId::new(),
                                name: "read_file".into(),
                                arguments: json!({"path": "a.rs"}),
                            };
                            (
                                ExecutionEvent::ToolCallRequested { request_id, call },
                                "tool_use",
                            )
                        } else {
                            let text = if self.turn == 1 { BRIEF } else { ANALYSIS };
                            (
                                ExecutionEvent::TextDelta {
                                    request_id,
                                    delta: text.into(),
                                },
                                "end_turn",
                            )
                        };
                        self.state
                            .host_execute_event(self.session, call_id, event)
                            .unwrap();
                        self.state
                            .host_execute_result(
                                self.session,
                                call_id,
                                Ok(ExecutionResult {
                                    request_id,
                                    usage: ModelUsage::default(),
                                    cost: Cost::default(),
                                    finish_reason: finish.into(),
                                }),
                            )
                            .unwrap();
                        self.turn += 1;
                    }
                    BridgeEvent::HostToolCall { call_id, .. } => {
                        self.state
                            .host_tool_result(
                                self.session,
                                call_id,
                                Ok(json!({ "content": "fn main() {}" })),
                            )
                            .unwrap();
                    }
                    _ => {}
                }
                let done = stop(&event);
                seen.push(event);
                if done {
                    break;
                }
            }
            seen
        }
    }

    fn started(events: &[BridgeEvent], node: &str) -> bool {
        events.iter().any(|event| {
            matches!(event, BridgeEvent::WorkflowEvent(envelope)
            if envelope["event"]["type"] == "step_started" && envelope["event"]["node_id"] == node)
        })
    }

    fn succeeded(event: &BridgeEvent, node: &str) -> bool {
        matches!(event, BridgeEvent::WorkflowEvent(envelope)
            if envelope["event"]["type"] == "step_succeeded" && envelope["event"]["node_id"] == node)
    }

    /// The foundation of mid-run flow switching: pausing during a step lets that
    /// step finish, holds the next one, and exposes the finished output.
    #[tokio::test]
    async fn pausing_mid_step_holds_the_next_step_until_resume() {
        let mut run = start_investigate().await;
        // Wait for the first model turn of Research, then pause while it is still running.
        run.pump(Duration::from_secs(5), |event| {
            matches!(event, BridgeEvent::HostExecuteCall { .. })
        })
        .await;
        run.state
            .workflow_control(run.session, WorkflowControl::Pause)
            .await
            .expect("pause is legal mid-step");

        let before = run.pump(Duration::from_millis(600), |_| false).await;
        assert!(
            before.iter().any(|event| succeeded(event, "research")),
            "the running step still finishes"
        );
        assert!(
            !started(&before, "analyze"),
            "the next step is not admitted while paused"
        );

        let snapshot = run
            .state
            .workflow_state(run.session, Some("research".into()))
            .await
            .unwrap();
        assert_eq!(snapshot["status"], "paused", "{snapshot}");
        assert_eq!(snapshot["steps"]["research"]["status"], "succeeded");
        assert_eq!(
            snapshot["steps"]["research"]["output"], BRIEF,
            "the finished step's output is readable"
        );
        assert_ne!(snapshot["steps"]["analyze"]["status"], "running");

        run.state
            .workflow_control(run.session, WorkflowControl::Resume)
            .await
            .expect("resume");
        let after = run
            .pump(Duration::from_secs(5), |event| {
                matches!(event, BridgeEvent::WorkflowFinished { .. })
            })
            .await;
        assert!(
            started(&after, "analyze"),
            "the next step runs after resume"
        );
        let Some(BridgeEvent::WorkflowFinished { state: finished }) = after.last() else {
            panic!("the run finishes")
        };
        assert_eq!(finished["status"], "completed");
        assert_eq!(finished["final_output"], ANALYSIS);
        run.state.close_session(run.session).await.unwrap();
    }

    /// Cancelling a paused run is how a switch ends the old flow: it must keep what finished.
    #[tokio::test]
    async fn cancelling_a_paused_run_keeps_the_finished_steps_outputs() {
        let mut run = start_investigate().await;
        run.pump(Duration::from_secs(5), |event| {
            matches!(event, BridgeEvent::HostExecuteCall { .. })
        })
        .await;
        run.state
            .workflow_control(run.session, WorkflowControl::Pause)
            .await
            .unwrap();
        let before = run.pump(Duration::from_millis(600), |_| false).await;
        assert!(before.iter().any(|event| succeeded(event, "research")));

        run.state
            .workflow_control(run.session, WorkflowControl::Cancel)
            .await
            .unwrap();
        let after = run
            .pump(Duration::from_secs(5), |event| {
                matches!(event, BridgeEvent::WorkflowFinished { .. })
            })
            .await;
        assert!(
            !started(&after, "analyze"),
            "the cancelled run never starts the next step"
        );
        let Some(BridgeEvent::WorkflowFinished { state: finished }) = after.last() else {
            panic!("the run finishes")
        };
        assert_eq!(finished["status"], "cancelled", "{finished}");
        assert_eq!(finished["steps"]["research"]["output"], BRIEF);
        run.state.close_session(run.session).await.unwrap();
    }

    #[tokio::test]
    async fn the_state_of_a_session_without_a_run_is_an_error() {
        let state = HarnessState::new();
        let recipe: SessionRecipe = serde_json::from_value(json!({
            "workspace": { "root": "/tmp", "binding": "host" },
            "integration": "host",
            "workflow": workflow_document(),
        }))
        .unwrap();
        let session = state.create_session(recipe).await.unwrap();
        let error = state
            .workflow_state(session, None)
            .await
            .expect_err("nothing is running");
        assert!(error.contains("no workflow"), "{error}");
        state.close_session(session).await.unwrap();
    }

    #[tokio::test]
    async fn the_starter_flow_rejects_blocked_and_retries_build_with_the_plan() {
        run_starter_flow(true).await;
    }

    async fn run_starter_flow(blocked_first: bool) {
        let root = std::env::temp_dir().join(format!("rusty-starter-flow-{}", uuid_like()));
        std::fs::create_dir_all(root.join(".rusty/profiles")).unwrap();
        std::fs::create_dir_all(root.join("src")).unwrap();
        std::fs::write(
            root.join(".rusty/profiles/plan.json"),
            include_str!(
                "../../../src/components/tabs/behaviors/starter/legacy/v2/plan.profile.json"
            ),
        )
        .unwrap();
        std::fs::write(
            root.join(".rusty/profiles/build.json"),
            include_str!(
                "../../../src/components/tabs/behaviors/starter/legacy/v2/build.profile.json"
            ),
        )
        .unwrap();
        std::fs::write(root.join("src/lib.rs"), "pub fn answer() -> u32 { 42 }\n").unwrap();

        let plan = json!({
            "summary": "Add answer()",
            "steps": [{ "title": "Add the function", "detail": "Edit src/lib.rs" }],
            "filesToChange": ["src/lib.rs"],
            "risks": []
        });
        let built = json!({
            "summary": "Added answer()",
            "status": "completed",
            "artifacts": [{ "kind": "file", "reference": "src/lib.rs" }],
            "claimsToVerify": []
        });

        let state = HarnessState::new();
        let recipe: SessionRecipe = serde_json::from_value(json!({
            "workspace": { "root": root, "binding": "disk" },
            "integration": "host",
            "host_tools": [
                { "name": "read_file", "description": "Read a file" },
                { "name": "write_file", "description": "Write a file" },
                { "name": "list_files", "description": "List files" },
            ],
            "workflow": starter(include_str!("../../../src/components/tabs/behaviors/starter/legacy/v2/plan-build-verify.workflow.json")),
        }))
        .unwrap();
        let session_id = state
            .create_session(recipe)
            .await
            .expect("session with the starter flow");
        let mut inbox = state.take_inbox(session_id).unwrap();
        state
            .start_workflow(session_id, json!({ "request": "add answer()" }))
            .await
            .expect("run starts");

        // One scripted model turn per step-turn: Plan looks around, then
        // plans; Build reads, edits, checks its edit, then reports.
        let script = |turn: usize| -> (&'static str, serde_json::Value) {
            match turn {
                1 => ("list_files", json!({ "path": "." })),
                3 => ("read_file", json!({ "path": "src/lib.rs" })),
                4 => (
                    "write_file",
                    json!({ "path": "src/lib.rs", "content": "pub fn answer() -> u32 { 42 }\n" }),
                ),
                5 => ("read_file", json!({ "path": "src/lib.rs" })),
                7 => ("read_file", json!({ "path": "src/lib.rs" })),
                _ => ("", serde_json::Value::Null),
            }
        };
        let mut turns = 0;
        let mut started = Vec::new();
        let mut offered: Vec<(usize, serde_json::Value)> = Vec::new();
        let final_state = loop {
            let event = tokio::time::timeout(Duration::from_secs(10), inbox.recv())
                .await
                .expect("the run must not stall")
                .expect("the inbox stays open");
            match event {
                BridgeEvent::HostExecuteCall { call_id, input, .. } => {
                    turns += 1;
                    offered.push((turns, input.clone()));
                    let request_id = RequestId::new();
                    let (tool, arguments) = script(turns);
                    let (event, finish) = if !tool.is_empty() {
                        let call = ToolCall {
                            id: ToolCallId::new(),
                            name: tool.into(),
                            arguments,
                        };
                        (
                            ExecutionEvent::ToolCallRequested { request_id, call },
                            "tool_use",
                        )
                    } else {
                        let reply = if turns == 2 {
                            plan.clone()
                        } else if blocked_first && turns == 6 {
                            json!({
                                "summary": "Validation requires an unavailable dependency",
                                "status": "blocked",
                                "artifacts": [],
                                "claimsToVerify": ["Install the required dependency before validation"]
                            })
                        } else {
                            built.clone()
                        };
                        (
                            ExecutionEvent::TextDelta {
                                request_id,
                                delta: reply.to_string(),
                            },
                            "end_turn",
                        )
                    };
                    state
                        .host_execute_event(session_id, &call_id, event)
                        .unwrap();
                    let result = ExecutionResult {
                        request_id,
                        usage: ModelUsage::default(),
                        cost: Cost::default(),
                        finish_reason: finish.into(),
                    };
                    state
                        .host_execute_result(session_id, &call_id, Ok(result))
                        .unwrap();
                }
                BridgeEvent::HostToolCall { call_id, .. } => {
                    state
                        .host_tool_result(session_id, &call_id, Ok(json!({ "content": "ok" })))
                        .unwrap();
                }
                BridgeEvent::WorkflowEvent(envelope) => {
                    if envelope["event"]["type"] == "step_started" {
                        started.push(
                            envelope["event"]["node_id"]
                                .as_str()
                                .unwrap_or_default()
                                .to_string(),
                        );
                    }
                }
                BridgeEvent::WorkflowFinished { state } => break state,
                _ => {}
            }
        };

        assert_eq!(final_state["status"], "completed", "{final_state}");
        assert_eq!(final_state["final_output"], built);
        let expected = if blocked_first {
            vec![
                "input", "plan", "build", "verify", "build", "verify", "output",
            ]
        } else {
            vec!["input", "plan", "build", "verify", "output"]
        };
        assert_eq!(started, expected);
        assert_eq!(turns, if blocked_first { 8 } else { 6 });

        // Verify the actual model request, not merely the graph edge: every
        // Build turn must retain the complete structured handoff from Plan.
        for turn in 3..=turns {
            let (_, request) = offered.iter().find(|(number, _)| *number == turn).unwrap();
            let prompt = request["messages"]
                .as_array()
                .unwrap()
                .iter()
                .filter(|message| message["role"] == "User")
                .flat_map(|message| message["content"].as_array().unwrap())
                .filter_map(|block| block["Text"]["text"].as_str())
                .find(|text| text.contains("<workflow_input>"))
                .expect("Build receives its workflow input in a user message");
            let handoff = prompt
                .split_once("<workflow_input>\n")
                .unwrap()
                .1
                .split_once("\n</workflow_input>")
                .unwrap()
                .0;
            assert!(
                handoff.contains("## request\nadd answer()"),
                "Build turn {turn} receives the request as Markdown: {handoff}"
            );
            for kept in [
                "## plan",
                "Add answer()",
                "Add the function",
                "Edit src/lib.rs",
                "src/lib.rs",
            ] {
                assert!(
                    handoff.contains(kept),
                    "Build turn {turn} must retain the full plan ({kept}): {handoff}"
                );
            }
            assert!(!handoff.contains('{'), "the handoff is Markdown, not JSON");
            if turn >= 7 {
                assert!(
                    prompt.contains("<rejections>"),
                    "Retry receives Verify feedback"
                );
                assert!(prompt.contains("blocked"), "Retry sees the rejected status");
            }
        }

        // Plan is read-only: it is never even offered a tool that edits or
        // runs. Build is offered the full set.
        let tools_offered = |turn: usize| -> String {
            let (_, input) = offered
                .iter()
                .find(|(number, _)| *number == turn)
                .expect("turn happened");
            input.to_string()
        };
        assert!(
            !tools_offered(1).contains("write_file"),
            "Plan must not be offered write_file"
        );
        assert!(
            tools_offered(1).contains("list_files"),
            "Plan keeps its read tools"
        );
        assert!(
            tools_offered(3).contains("write_file"),
            "Build is offered write_file"
        );

        state.close_session(session_id).await.unwrap();
        let _ = std::fs::remove_dir_all(&root);
    }

    /// input → approval of the request → output (the decision); no model turns.
    async fn approval_session(state: &HarnessState) -> SessionId {
        let document = json!({
            "schema_version": 1, "id": "ide.approve", "revision": 1, "name": "Approve", "status": "draft",
            "nodes": [
                { "id": "input", "name": "Input", "type": "input", "config": {} },
                { "id": "approve", "name": "Approve", "type": "approval",
                  "config": { "subject": { "type": "run_input", "pointer": "/request" } } },
                { "id": "output", "name": "Output", "type": "output",
                  "config": { "source": { "type": "node_output", "node_id": "approve", "pointer": "/decision" }, "strict": false } }
            ],
            "edges": [
                { "id": "a", "source": "input", "target": "approve", "condition": "on_success" },
                { "id": "b", "source": "approve", "target": "output", "condition": "on_success" }
            ]
        });
        let recipe: SessionRecipe = serde_json::from_value(json!({
            "workspace": { "root": "/tmp", "binding": "host" },
            "integration": "host",
            "workflow": document,
        }))
        .unwrap();
        state
            .create_session(recipe)
            .await
            .expect("session with a workflow")
    }

    async fn next_event(inbox: &mut mpsc::UnboundedReceiver<BridgeEvent>) -> BridgeEvent {
        tokio::time::timeout(Duration::from_secs(5), inbox.recv())
            .await
            .expect("the run must not stall")
            .expect("the inbox stays open")
    }

    #[tokio::test]
    async fn an_approval_waits_for_the_answer_given_through_workflow_control() {
        let state = HarnessState::new();
        let session_id = approval_session(&state).await;
        let mut inbox = state.take_inbox(session_id).unwrap();
        state
            .start_workflow(session_id, json!({ "request": "ship it" }))
            .await
            .unwrap();
        let request_id = loop {
            if let BridgeEvent::WorkflowEvent(value) = next_event(&mut inbox).await {
                if value["event"]["type"] == "input_requested" {
                    assert_eq!(value["event"]["request"]["subject"], "ship it");
                    break value["event"]["request"]["id"].as_str().unwrap().to_owned();
                }
            }
        };
        let refused = state
            .workflow_control(
                session_id,
                WorkflowControl::ResolveInput {
                    request_id: request_id.clone(),
                    decision: "maybe".into(),
                    text: None,
                },
            )
            .await;
        assert!(refused.is_err(), "an answer that was not offered");
        let control: WorkflowControl = serde_json::from_value(json!({
            "type": "resolve_input", "request_id": request_id, "decision": "approve", "text": "looks right"
        }))
        .unwrap();
        state.workflow_control(session_id, control).await.unwrap();
        let final_state = loop {
            if let BridgeEvent::WorkflowFinished { state } = next_event(&mut inbox).await {
                break state;
            }
        };
        assert_eq!(final_state["status"], "completed", "{final_state}");
        assert_eq!(final_state["final_output"], "approved");
        assert_eq!(
            final_state["steps"]["approve"]["output"]["notes"],
            "looks right"
        );
        state.close_session(session_id).await.unwrap();
    }

    #[tokio::test]
    async fn a_run_started_with_auto_approve_does_not_ask() {
        let state = HarnessState::new();
        let session_id = approval_session(&state).await;
        let mut inbox = state.take_inbox(session_id).unwrap();
        let options: WorkflowStartOptions =
            serde_json::from_value(json!({ "autoApprove": true })).unwrap();
        state
            .start_workflow_from_checkpoint(
                session_id,
                json!({ "request": "ship it" }),
                None,
                options,
            )
            .await
            .unwrap();
        let final_state = loop {
            match next_event(&mut inbox).await {
                BridgeEvent::WorkflowEvent(value) => {
                    assert_ne!(value["event"]["type"], "input_requested")
                }
                BridgeEvent::WorkflowFinished { state } => break state,
                _ => {}
            }
        };
        assert_eq!(final_state["status"], "completed", "{final_state}");
        assert_eq!(final_state["steps"]["approve"]["output"]["by"], "auto");
        assert_eq!(final_state["options"]["auto_approve"], true);
        state.close_session(session_id).await.unwrap();
    }

    /// input → sub (a subflow of `target`) → output.
    fn calling(target: serde_json::Value) -> serde_json::Value {
        json!({
            "schema_version": 1, "id": "ide.caller", "revision": 1, "name": "Caller", "status": "draft",
            "nodes": [
                { "id": "input", "name": "Input", "type": "input", "config": {} },
                { "id": "sub", "name": "Gather", "type": "subflow", "config": { "target": target },
                  "input_bindings": [{ "target": "request", "source": { "type": "run_input", "pointer": "/request" } }] },
                { "id": "output", "name": "Output", "type": "output",
                  "config": { "source": { "type": "node_output", "node_id": "sub", "pointer": "" }, "strict": false } }
            ],
            "edges": [
                { "id": "a", "source": "input", "target": "sub", "condition": "on_success" },
                { "id": "b", "source": "sub", "target": "output", "condition": "on_success" }
            ]
        })
    }

    async fn start_calling(
        target: serde_json::Value,
        library: Vec<serde_json::Value>,
    ) -> Result<(), String> {
        let state = HarnessState::new();
        let recipe: SessionRecipe = serde_json::from_value(json!({
            "workspace": { "root": "/tmp", "binding": "host" },
            "integration": "host",
            "workflow": calling(target),
            "workflow_library": library,
        }))
        .unwrap();
        let session_id = state.create_session(recipe).await.expect("session");
        let started = state
            .start_workflow(session_id, json!({ "request": "look into it" }))
            .await
            .map(|_| ());
        state.close_session(session_id).await.unwrap();
        started
    }

    #[tokio::test]
    async fn a_workflow_may_run_a_built_in_workflow_as_a_subflow() {
        start_calling(
            json!({ "type": "flow", "id": "rusty-ide.builtin.investigate" }),
            vec![],
        )
        .await
        .expect("built-in workflows are always available");
    }

    #[tokio::test]
    async fn a_workflow_may_run_a_saved_workflow_sent_with_the_session() {
        let mut helper = harness_engine::validation::templates().default_workflow;
        helper["id"] = json!("ws.helper");
        helper["status"] = json!("draft");
        start_calling(json!({ "type": "flow", "id": "ws.helper" }), vec![helper])
            .await
            .expect("saved workflows come with the session");
    }

    #[tokio::test]
    async fn a_subflow_that_does_not_exist_is_refused_by_name() {
        let error = start_calling(json!({ "type": "flow", "id": "ws.missing" }), vec![])
            .await
            .expect_err("unknown flow");
        assert!(error.contains("ws.missing"), "{error}");
    }

    #[tokio::test]
    async fn a_subflow_step_under_a_built_in_profile_is_accepted() {
        let target = json!({
            "type": "step", "instructions": "Find where the sessions are stored.",
            "profile": { "id": "rusty-ide.builtin.research" }
        });
        start_calling(target, vec![])
            .await
            .expect("built-in profiles resolve");
    }
}
