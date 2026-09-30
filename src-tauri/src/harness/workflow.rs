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

/// Registers `document` on a fresh per-session orchestration config and
/// enables it on `builder`. Drafts are allowed for both the workflow and the
/// profiles its steps name: the Behaviors canvas creates both as drafts.
pub fn configure(builder: SessionBuilder, document: serde_json::Value) -> Result<(SessionBuilder, (String, u64)), String> {
    let config = OrchestrationConfig::default().allow_drafts(true);
    let key = config.register_json(document).map_err(|error| error.to_string())?;
    Ok((builder.orchestration(config).allow_draft_profiles(true), key))
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
    ResolvePermission { id: String, decision: PermissionDecision },
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
                        let final_state = serde_json::to_value(&*state.borrow()).unwrap_or_default();
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
                    let _ = outbound.send(BridgeEvent::Gap { last_delivered_sequence: None, dropped });
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
    pub async fn start_workflow(&self, session_id: SessionId, input: serde_json::Value) -> Result<String, String> {
        let (handle, workflow, outbound) = self
            .with_session(&session_id, |entry| (entry.handle.clone(), entry.workflow.clone(), entry.outbound.clone()))
            .ok_or_else(|| "no such session".to_string())?;
        let (id, revision) = workflow.ok_or_else(|| "this session was not created with a workflow".to_string())?;
        if self.with_session(&session_id, |entry| entry.workflow_run.lock().unwrap().is_some()) == Some(true) {
            return Err("a workflow is already running on this session".to_string());
        }

        let run_id = format!("{id}-{}", uuid_like());
        let mut run = handle
            .start_orchestration(OrchestrationRequest::exact(run_id.clone(), id, revision, input))
            .await
            .map_err(|error| error.to_string())?;
        let pump = forward_updates(run.subscribe(), run.watch(), outbound);
        let started = WorkflowRun { handle: Arc::new(run), pump };
        self.with_session(&session_id, move |entry| *entry.workflow_run.lock().unwrap() = Some(started))
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

    pub async fn workflow_control(&self, session_id: SessionId, control: WorkflowControl) -> Result<(), String> {
        let handle = self
            .with_session(&session_id, |entry| entry.workflow_run.lock().unwrap().as_ref().map(|run| run.handle.clone()))
            .ok_or_else(|| "no such session".to_string())?
            .ok_or_else(|| "no workflow is running on this session".to_string())?;
        let result = match control {
            WorkflowControl::Cancel => {
                handle.cancel();
                Ok(())
            }
            WorkflowControl::Pause => handle.pause().await,
            WorkflowControl::Resume => handle.resume().await,
            WorkflowControl::ResolvePermission { id, decision } => handle.resolve_permission(id, decision).await,
        };
        result.map_err(|error| error.to_string())
    }
}

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
        let session_id = state.create_session(recipe).await.expect("session with a workflow");
        let mut inbox = state.take_inbox(session_id).unwrap();

        let error = state
            .workflow_control(session_id, WorkflowControl::Cancel)
            .await
            .expect_err("nothing is running yet");
        assert!(error.contains("no workflow"), "{error}");
        state.start_workflow(session_id, json!({ "request": "go" })).await.expect("run starts");

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
                        assert_eq!(input["params"]["model"], "stronger-model", "the step-up applies to the step's next turn");
                    }
                    let request_id = RequestId::new();
                    let (event, finish) = if turns == 1 {
                        let call = ToolCall { id: read_call, name: "read_file".into(), arguments: json!({ "path": "a.rs" }) };
                        (ExecutionEvent::ToolCallRequested { request_id, call }, "tool_use")
                    } else {
                        (ExecutionEvent::TextDelta { request_id, delta: report().to_string() }, "end_turn")
                    };
                    state.host_execute_event(session_id, &call_id, event).unwrap();
                    let result = ExecutionResult {
                        request_id,
                        usage: ModelUsage::default(),
                        cost: Cost::default(),
                        finish_reason: finish.into(),
                    };
                    state.host_execute_result(session_id, &call_id, Ok(result)).unwrap();
                }
                // Answered on this session's bridge, but attributed to the
                // step's own session so the IDE can match it to the step's
                // ToolCallRequested.
                BridgeEvent::HostToolCall { call_id, tool, tool_call_id, session_id: caller, .. } => {
                    assert_eq!(tool, "read_file");
                    assert_eq!(tool_call_id, Some(read_call.to_string()));
                    let caller = caller.expect("the requesting session is named");
                    assert_ne!(caller, session_id.to_string(), "steps run in their own session");
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
                    state.host_tool_result(session_id, &call_id, Ok(json!({ "content": "fn main() {}" }))).unwrap();
                }
                BridgeEvent::WorkflowEvent(envelope) => {
                    kinds.push(envelope["event"]["type"].as_str().unwrap_or_default().to_string());
                }
                BridgeEvent::WorkflowAgentEvent { node_id, envelope, .. } => {
                    assert_eq!(node_id, "execute");
                    if let Some(step) = &step_session {
                        assert_eq!(&envelope.session_id.to_string(), step, "step events carry the same session id");
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
            .configure_step_execution(session_id, step_session.unwrap().parse().unwrap(), Default::default())
            .await
            .expect_err("a finished step's session is gone");
        assert!(gone.contains("unavailable") || gone.contains("not"), "{gone}");
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

    // The Plan → Build → Verify flow the IDE seeds into a workspace's
    // `.rusty/` folder, read from the same files the frontend imports.
    const STARTER_WORKFLOW: &str =
        include_str!("../../../src/components/tabs/behaviors/starter/plan-build-verify.workflow.json");
    const STARTER_PLAN: &str = include_str!("../../../src/components/tabs/behaviors/starter/plan.profile.json");
    const STARTER_BUILD: &str = include_str!("../../../src/components/tabs/behaviors/starter/build.profile.json");

    fn starter(text: &str) -> serde_json::Value {
        serde_json::from_str(text).expect("a starter document is valid JSON")
    }

    #[test]
    fn the_starter_flow_compiles_without_issues() {
        let library = vec![starter(STARTER_PLAN), starter(STARTER_BUILD)];
        for profile in &library {
            let issues = harness_engine::validation::validate_profile(profile, &library);
            assert!(issues.is_empty(), "{issues:?}");
        }
        let issues = harness_engine::validation::validate_orchestration(&starter(STARTER_WORKFLOW), &library);
        assert!(issues.is_empty(), "{issues:?}");
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
        assert_eq!(agents.len(), 2, "plan and build");
        for node in agents {
            assert_eq!(node["config"]["structured_output"], "host_validated", "{}", node["id"]);
        }
    }

    /// Runs the seeded files as a user would get them: profiles loaded from
    /// `.rusty/profiles`, Plan's result handed to Build, and Verify checking
    /// on disk that the file Build claims to have changed exists.
    #[tokio::test]
    async fn the_starter_flow_plans_builds_and_verifies() {
        let root = std::env::temp_dir().join(format!("rusty-starter-flow-{}", uuid_like()));
        std::fs::create_dir_all(root.join(".rusty/profiles")).unwrap();
        std::fs::create_dir_all(root.join("src")).unwrap();
        std::fs::write(root.join(".rusty/profiles/plan.json"), STARTER_PLAN).unwrap();
        std::fs::write(root.join(".rusty/profiles/build.json"), STARTER_BUILD).unwrap();
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
            "workflow": starter(STARTER_WORKFLOW),
        }))
        .unwrap();
        let session_id = state.create_session(recipe).await.expect("session with the starter flow");
        let mut inbox = state.take_inbox(session_id).unwrap();
        state.start_workflow(session_id, json!({ "request": "add answer()" })).await.expect("run starts");

        // One scripted model turn per step-turn: Plan looks around, then
        // plans; Build reads, edits, checks its edit, then reports.
        let script = |turn: usize| -> (&'static str, serde_json::Value) {
            match turn {
                1 => ("list_files", json!({ "path": "." })),
                3 => ("read_file", json!({ "path": "src/lib.rs" })),
                4 => ("write_file", json!({ "path": "src/lib.rs", "content": "pub fn answer() -> u32 { 42 }\n" })),
                5 => ("read_file", json!({ "path": "src/lib.rs" })),
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
                        let call = ToolCall { id: ToolCallId::new(), name: tool.into(), arguments };
                        (ExecutionEvent::ToolCallRequested { request_id, call }, "tool_use")
                    } else {
                        let reply = if turns == 2 { plan.clone() } else { built.clone() };
                        (ExecutionEvent::TextDelta { request_id, delta: reply.to_string() }, "end_turn")
                    };
                    state.host_execute_event(session_id, &call_id, event).unwrap();
                    let result = ExecutionResult {
                        request_id,
                        usage: ModelUsage::default(),
                        cost: Cost::default(),
                        finish_reason: finish.into(),
                    };
                    state.host_execute_result(session_id, &call_id, Ok(result)).unwrap();
                }
                BridgeEvent::HostToolCall { call_id, .. } => {
                    state.host_tool_result(session_id, &call_id, Ok(json!({ "content": "ok" }))).unwrap();
                }
                BridgeEvent::WorkflowEvent(envelope) => {
                    if envelope["event"]["type"] == "step_started" {
                        started.push(envelope["event"]["node_id"].as_str().unwrap_or_default().to_string());
                    }
                }
                BridgeEvent::WorkflowFinished { state } => break state,
                _ => {}
            }
        };

        assert_eq!(final_state["status"], "completed", "{final_state}");
        assert_eq!(final_state["final_output"], built);
        assert_eq!(started, ["input", "plan", "build", "verify", "output"]);
        assert_eq!(turns, 6, "two Plan turns and four Build turns");

        // Plan is read-only: it is never even offered a tool that edits or
        // runs. Build is offered the full set.
        let tools_offered = |turn: usize| -> String {
            let (_, input) = offered.iter().find(|(number, _)| *number == turn).expect("turn happened");
            input.to_string()
        };
        assert!(!tools_offered(1).contains("write_file"), "Plan must not be offered write_file");
        assert!(tools_offered(1).contains("list_files"), "Plan keeps its read tools");
        assert!(tools_offered(3).contains("write_file"), "Build is offered write_file");

        state.close_session(session_id).await.unwrap();
        let _ = std::fs::remove_dir_all(&root);
    }
}
