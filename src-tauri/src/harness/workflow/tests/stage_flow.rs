//! A stage workflow (Investigate: Research, then Analyze) end to end, and
//! pausing or cancelling it mid-run.

use super::*;

const BRIEF: &str = "## Brief\nUse the queue.";
const ANALYSIS: &str = "## Analysis\nThe queue lives in sync.rs.";

fn investigate() -> Value {
    with_builtin_profiles(starter(INVESTIGATE_WORKFLOW))
}

fn file_content() -> Value {
    json!({ "content": "fn main() {}" })
}

/// Each step reads a file (its completion gate), then writes its handoff.
fn read_then_handoff(turn: usize) -> Turn {
    if turn.is_multiple_of(2) {
        return tool("read_file", json!({"path": "a.rs"}));
    }
    text(if turn == 1 { BRIEF } else { ANALYSIS })
}

/// A stage workflow end to end: the earlier result reaches the first step as
/// `context`, the first step's written handoff reaches the second, and the
/// read-only profiles are never offered a tool that edits or runs.
#[tokio::test]
async fn a_stage_workflow_passes_context_and_handoffs_between_profiles() {
    let state = HarnessState::new();
    let tools = [
        ("read_file", "Read a file"),
        ("write_file", "Write a file"),
        ("run_command", "Run a command"),
    ];
    let recipe = host_recipe("/tmp", investigate(), &tools);
    let input = json!({ "request": "how does sync work", "context": "EARLIER-RESULT" });
    let (session, mut inbox) = start(&state, &recipe, input).await;

    let mut prompts = Vec::new();
    let mut offered = Vec::new();
    let finished = run_to_finish(
        &state,
        session,
        &mut inbox,
        file_content(),
        |turn, input| {
            prompts.push(prompt_text(input));
            offered.push(input["tools"].to_string());
            read_then_handoff(turn)
        },
    )
    .await;

    let final_state = &finished.state;
    assert_eq!(final_state["status"], "completed", "{final_state}");
    assert_eq!(final_state["final_output"], ANALYSIS);
    assert_eq!(finished.turns, 4, "two steps of a read and a reply each");
    assert!(
        prompts[0].contains("EARLIER-RESULT"),
        "Research receives the earlier result as context"
    );
    assert!(prompts[0].contains("how does sync work"));
    assert!(
        prompts[2].contains(BRIEF),
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
    inbox: mpsc::UnboundedReceiver<BridgeEvent>,
    turn: usize,
}

async fn start_investigate() -> StageRun {
    let state = HarnessState::new();
    let recipe = host_recipe("/tmp", investigate(), &[("read_file", "Read a file")]);
    let input = json!({ "request": "how does sync work", "context": "" });
    let (session, inbox) = start(&state, &recipe, input).await;
    StageRun {
        state,
        session,
        inbox,
        turn: 0,
    }
}

impl StageRun {
    /// Answers model turns until `stop` says the events so far are enough, or the
    /// run goes quiet for `quiet`.
    async fn pump(
        &mut self,
        quiet: Duration,
        mut stop: impl FnMut(&BridgeEvent) -> bool,
    ) -> Vec<BridgeEvent> {
        let mut seen = Vec::new();
        while let Ok(Some(event)) = tokio::time::timeout(quiet, self.inbox.recv()).await {
            self.respond(&event);
            let done = stop(&event);
            seen.push(event);
            if done {
                break;
            }
        }
        seen
    }

    fn respond(&mut self, event: &BridgeEvent) {
        match event {
            BridgeEvent::HostExecuteCall { call_id, .. } => {
                answer(
                    &self.state,
                    self.session,
                    call_id,
                    read_then_handoff(self.turn),
                );
                self.turn += 1;
            }
            BridgeEvent::HostToolCall { call_id, .. } => self
                .state
                .host_tool_result(self.session, call_id, Ok(file_content()))
                .unwrap(),
            _ => {}
        }
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
