//! A workflow's steps run through the session's own host bridge.

use harness_protocol::ids::ToolCallId;

use super::*;

/// What the IDE has seen of a run.
#[derive(Default)]
struct Observed {
    kinds: Vec<String>,
    agent_events: usize,
    turns: usize,
    step_session: Option<String>,
}

impl Observed {
    /// A step's agent event: it comes from the step, under the step's session.
    fn agent_event(&mut self, node_id: &str, session: String) {
        assert_eq!(node_id, "execute");
        if let Some(step) = &self.step_session {
            assert_eq!(&session, step, "step events carry the same session id");
        }
        self.agent_events += 1;
    }
}

/// The step's first turn reads a file; its second reports, on the model the
/// step was stepped up to.
fn read_then_report(turn: usize, input: &Value, read_call: ToolCallId) -> Turn {
    if turn == 2 {
        assert_eq!(
            input["params"]["model"], "stronger-model",
            "the step-up applies to the step's next turn"
        );
    }
    if turn != 1 {
        return text(report().to_string());
    }
    Turn::Tool(ToolCall {
        id: read_call,
        name: "read_file".into(),
        arguments: json!({ "path": "a.rs" }),
    })
}

/// Host tool calls are answered on this session's bridge but attributed to
/// the step's own session, so the IDE can match them to the step's
/// `ToolCallRequested`. Moves the step to a stronger model the way the JEV
/// decision tool does, and returns the step's session.
async fn step_up(state: &HarnessState, session_id: SessionId, caller: Option<String>) -> String {
    let caller = caller.expect("the requesting session is named");
    assert_ne!(
        caller,
        session_id.to_string(),
        "steps run in their own session"
    );
    let params = harness_protocol::backend::ExecutionParams {
        model: Some("stronger-model".into()),
        ..Default::default()
    };
    state
        .configure_step_execution(session_id, caller.parse().unwrap(), params)
        .await
        .expect("the running step is reachable");
    caller
}

/// Answers the run's model turns and host tool calls until it finishes;
/// returns its final state and what was seen on the way.
async fn answer_as_the_ide(
    state: &HarnessState,
    session_id: SessionId,
    inbox: &mut mpsc::UnboundedReceiver<BridgeEvent>,
) -> (Value, Observed) {
    let read_call = ToolCallId::new();
    let mut seen = Observed::default();
    loop {
        match next_event(inbox).await {
            BridgeEvent::HostExecuteCall { call_id, input, .. } => {
                seen.turns += 1;
                let turn = read_then_report(seen.turns, &input, read_call);
                answer(state, session_id, &call_id, turn);
            }
            BridgeEvent::HostToolCall {
                call_id,
                tool,
                tool_call_id,
                session_id: caller,
                ..
            } => {
                assert_eq!(tool, "read_file");
                assert_eq!(tool_call_id, Some(read_call.to_string()));
                seen.step_session = Some(step_up(state, session_id, caller).await);
                let content = Ok(json!({ "content": "fn main() {}" }));
                state
                    .host_tool_result(session_id, &call_id, content)
                    .unwrap();
            }
            BridgeEvent::WorkflowEvent(envelope) => seen.kinds.push(
                envelope["event"]["type"]
                    .as_str()
                    .unwrap_or_default()
                    .to_string(),
            ),
            BridgeEvent::WorkflowAgentEvent {
                node_id, envelope, ..
            } => seen.agent_event(&node_id, envelope.session_id.to_string()),
            BridgeEvent::WorkflowFinished { state } => return (state, seen),
            _ => {}
        }
    }
}

#[tokio::test]
async fn a_workflow_runs_its_steps_through_the_sessions_host_bridge() {
    let state = HarnessState::new();
    let recipe = host_recipe("/tmp", workflow_document(), &[("read_file", "Read a file")]);
    let session_id = state
        .create_session(serde_json::from_value(recipe).unwrap())
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

    let (final_state, seen) = answer_as_the_ide(&state, session_id, &mut inbox).await;

    assert_eq!(final_state["status"], "completed", "{final_state}");
    assert_eq!(final_state["final_output"], report());
    assert!(
        seen.kinds.contains(&"step_succeeded".to_string()),
        "{:?}",
        seen.kinds
    );
    assert_eq!(seen.kinds.last().map(String::as_str), Some("run_completed"));
    assert!(
        seen.agent_events > 0,
        "the step's agent events are forwarded"
    );
    assert_eq!(seen.turns, 2);
    let step_session = seen.step_session.expect("the step called its host tool");
    let gone = state
        .configure_step_execution(
            session_id,
            step_session.parse().unwrap(),
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
    let recipe = host_recipe("/tmp", json!({ "id": "broken" }), &[]);
    let error = state
        .create_session(serde_json::from_value(recipe).unwrap())
        .await
        .expect_err("rejected");
    assert!(error.contains("orchestration definition"), "{error}");
}

#[tokio::test]
async fn the_state_of_a_session_without_a_run_is_an_error() {
    let state = HarnessState::new();
    let recipe = host_recipe("/tmp", workflow_document(), &[]);
    let session = state
        .create_session(serde_json::from_value(recipe).unwrap())
        .await
        .unwrap();
    let error = state
        .workflow_state(session, None)
        .await
        .expect_err("nothing is running");
    assert!(error.contains("no workflow"), "{error}");
    state.close_session(session).await.unwrap();
}
