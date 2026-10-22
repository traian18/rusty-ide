//! The starter's Plan, Build and Verify loop, run with text replies: what
//! each step is handed, and how a failure or a failed verdict sends Build
//! back.

use super::*;

const REQUEST: &str = "Implement the requested feature";

/// The starter (or a part of it) on the built-in profiles, in `root`.
fn build_recipe(root: &std::path::Path, document: Value) -> Value {
    host_recipe(
        root,
        with_builtin_profiles(document),
        &[
            ("list_files", "List workspace files"),
            ("read_file", "Read a file"),
        ],
    )
}

fn no_files() -> Value {
    json!({"files": []})
}

/// Every step reads a file (Verify's completion gate wants inspection
/// evidence), then answers with its entry of `replies`.
fn read_then_reply(turn: usize, replies: &[&str]) -> Turn {
    if turn.is_multiple_of(2) {
        tool("read_file", json!({"path": "."}))
    } else {
        text(replies[turn / 2])
    }
}

#[tokio::test]
async fn text_workflow_passes_verbatim_messages_to_build_and_review() {
    run_text_workflow(false).await;
}

#[tokio::test]
async fn failed_workflow_continues_build_on_a_new_session_without_repeating_plan() {
    run_text_workflow(true).await;
}

const PLAN: &str = "## Plan\n1. Preserve `\"quotes\"` and {not JSON}.\n2. Test the change.\n";
const BUILD: &str =
    "Implemented step 1.\nTests failed: dependency unavailable.\nDo not approve this yet.\nStatus: done";
const SUMMARY: &str = "## Verification\nAll checks passed.";

/// The model side of `run_text_workflow`. Its turns count across the run
/// and, after an injected failure, the run that continues it.
struct TextFlow {
    review: String,
    inject_failure: bool,
    failure_sent: bool,
    turn: usize,
}

impl TextFlow {
    fn reply(&mut self, input: &Value) -> Turn {
        if self.inject_failure && self.turn == 2 && !self.failure_sent {
            self.failure_sent = true;
            return Turn::Fail(ExecutionError::BackendError {
                message: "HTTP 400: tool_use without tool_result".into(),
                code: "400".into(),
            });
        }
        self.check_request(input);
        let turn = self.turn;
        self.turn += 1;
        if !turn.is_multiple_of(2) {
            let replies = [PLAN, BUILD, self.review.as_str()];
            return text(replies[turn / 2]);
        }
        let name = if turn == 0 { "list_files" } else { "read_file" };
        tool(name, json!({"path": "."}))
    }

    /// Text steps get their inputs verbatim. A structured step (Verify) is
    /// sent them as JSON, so the same text arrives escaped.
    fn check_request(&self, input: &Value) {
        let prompt = prompt_text(input);
        let turn = self.turn;
        assert!(prompt.contains(REQUEST));
        assert!(input["params"]["response_format"].is_null());
        if turn < 4 {
            assert!(
                !prompt.contains("JSON Schema"),
                "Plan and Build are text steps"
            );
        }
        let intact = |text: &str| {
            let quoted = serde_json::to_string(text).unwrap();
            prompt.contains(text) || prompt.contains(&quoted[1..quoted.len() - 1])
        };
        if turn >= 2 {
            assert!(intact(PLAN), "Plan arrives intact");
        }
        if turn == 2 || turn == 3 {
            assert!(prompt.contains(PLAN), "Plan arrives verbatim in Build");
        }
        if turn >= 4 {
            assert!(intact(BUILD), "Build arrives intact, including failure");
        }
    }
}

async fn run_text_workflow(inject_failure: bool) {
    let state = HarnessState::new();
    let directory = tempfile::tempdir().unwrap();
    let recipe = build_recipe(directory.path(), one_slice(starter(STARTER_WORKFLOW)));
    let (mut session, mut inbox) = start(&state, &recipe, json!({"request": REQUEST})).await;
    let mut flow = TextFlow {
        review: json!({"verdict": "pass", "summary": SUMMARY}).to_string(),
        inject_failure,
        failure_sent: false,
        turn: 0,
    };
    let mut finished = run_to_finish(&state, session, &mut inbox, no_files(), |_, input| {
        flow.reply(input)
    })
    .await;
    if inject_failure {
        assert_eq!(finished.state["status"], "failed", "{}", finished.state);
        assert_eq!(finished.state["failed_step"], "build");
        assert_eq!(flow.turn, 2, "only Plan finished before the failure");
        state.close_session(session).await.unwrap();
        (session, inbox) = continue_on_new_session(&state, &recipe, finished.state).await;
        finished = run_to_finish(&state, session, &mut inbox, no_files(), |_, input| {
            flow.reply(input)
        })
        .await;
    }

    let checkpoint = &finished.state;
    assert_eq!(checkpoint["status"], "completed", "{checkpoint}");
    assert_eq!(
        checkpoint["final_output"], SUMMARY,
        "the result is Verify's report"
    );
    assert_eq!(attempts(checkpoint, "plan"), 1);
    assert_eq!(
        attempts(checkpoint, "build"),
        if inject_failure { 2 } else { 1 }
    );
    assert_eq!(flow.turn, 6);
    assert!(!directory.path().join(".rusty/profiles").exists());
    state.close_session(session).await.unwrap();
}

/// Starts the failed run's workflow again, from its checkpoint, on a fresh
/// session.
async fn continue_on_new_session(
    state: &HarnessState,
    recipe: &Value,
    checkpoint: Value,
) -> (SessionId, mpsc::UnboundedReceiver<BridgeEvent>) {
    let session = state
        .create_session(serde_json::from_value(recipe.clone()).unwrap())
        .await
        .unwrap();
    let inbox = state.take_inbox(session).unwrap();
    state
        .start_workflow_from_checkpoint(
            session,
            json!({"request": "continue"}),
            Some(serde_json::from_value(checkpoint).unwrap()),
            WorkflowStartOptions::default(),
        )
        .await
        .unwrap();
    (session, inbox)
}

#[tokio::test]
async fn a_failed_verdict_sends_build_back_with_the_findings_until_it_passes() {
    let state = HarnessState::new();
    let directory = tempfile::tempdir().unwrap();
    let recipe = build_recipe(directory.path(), one_slice(starter(STARTER_WORKFLOW)));
    let (session, mut inbox) = start(&state, &recipe, json!({"request": REQUEST})).await;

    let finding = "src/a.ts:3 typecheck error TS2322";
    let failing =
        json!({"verdict": format!("fail: {finding}"), "summary": "Not done."}).to_string();
    let passing =
        json!({"verdict": "pass", "summary": "## Verified\nAll checks passed."}).to_string();
    // plan, build, verify (fails), build again, verify (passes).
    let replies = [
        "The plan",
        "Built it\nStatus: done",
        failing.as_str(),
        "Fixed it\nStatus: done",
        passing.as_str(),
    ];
    let finished = run_to_finish(&state, session, &mut inbox, no_files(), |turn, input| {
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
        read_then_reply(turn, &replies)
    })
    .await;

    let checkpoint = &finished.state;
    assert_eq!(checkpoint["status"], "completed", "{checkpoint}");
    assert_eq!(attempts(checkpoint, "plan"), 1, "Plan is not repeated");
    assert_eq!(attempts(checkpoint, "build"), 2);
    assert_eq!(attempts(checkpoint, "verify"), 2);
    assert_eq!(
        checkpoint["final_output"],
        "## Verified\nAll checks passed."
    );
    assert_eq!(finished.turns, 10);
    state.close_session(session).await.unwrap();
}

#[tokio::test]
async fn build_that_reports_work_left_is_sent_back_to_finish_it() {
    let state = HarnessState::new();
    let directory = tempfile::tempdir().unwrap();
    let recipe = build_recipe(directory.path(), one_slice(starter(STARTER_WORKFLOW)));
    let (session, mut inbox) = start(&state, &recipe, json!({"request": REQUEST})).await;

    let passing =
        json!({"verdict": "pass", "summary": "## Verified\nAll checks passed."}).to_string();
    // plan, build (stops early), build continued by its completion gate, verify.
    let replies = [
        "The plan",
        "Added the types.\n\n**Status:** Not done — the scanner remains.",
        "Added the scanner too.\n\nStatus: done",
        passing.as_str(),
    ];
    let finished = run_to_finish(&state, session, &mut inbox, no_files(), |turn, input| {
        if turn == 4 {
            let prompt = input["messages"].to_string();
            assert!(
                prompt.contains("[work-finished]"),
                "Build is told to keep going in the same step: {prompt}"
            );
        }
        read_then_reply(turn, &replies)
    })
    .await;

    let checkpoint = &finished.state;
    assert_eq!(checkpoint["status"], "completed", "{checkpoint}");
    assert_eq!(
        attempts(checkpoint, "build"),
        1,
        "finished within one attempt"
    );
    assert_eq!(attempts(checkpoint, "verify"), 1);
    assert_eq!(finished.turns, 8);
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
    let recipe = build_recipe(directory.path(), starter(STARTER_WORKFLOW));
    let (session, mut inbox) = start(&state, &recipe, json!({"request": REQUEST})).await;

    let finding = "src/b.ts:9 test failed: adds two numbers";
    let pass = json!({"verdict": "pass", "summary": "Slice one verified."}).to_string();
    let failing =
        json!({"verdict": format!("fail: {finding}"), "summary": "Not done."}).to_string();
    let done = json!({"verdict": "pass", "summary": "## Verified\nBoth slices pass."}).to_string();
    // plan, build, verify, build 2, verify 2 (fails), build 2 again, verify 2 (passes).
    let replies = [
        "## Slice 1\n1. a.ts\n## Slice 2\n2. b.ts",
        "Built slice one\nStatus: done",
        pass.as_str(),
        "Built slice two\nStatus: done",
        failing.as_str(),
        "Fixed slice two\nStatus: done",
        done.as_str(),
    ];
    let finished = run_to_finish(&state, session, &mut inbox, no_files(), |turn, input| {
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
        read_then_reply(turn, &replies)
    })
    .await;

    let checkpoint = &finished.state;
    assert_eq!(checkpoint["status"], "completed", "{checkpoint}");
    assert_eq!(attempts(checkpoint, "plan"), 1, "Plan is not repeated");
    assert_eq!(attempts(checkpoint, "build"), 1, "slice one is not rebuilt");
    assert_eq!(attempts(checkpoint, "verify"), 1, "nor re-verified");
    assert_eq!(attempts(checkpoint, "build_2"), 2);
    assert_eq!(attempts(checkpoint, "verify_2"), 2);
    assert_eq!(checkpoint["final_output"], "## Verified\nBoth slices pass.");
    assert_eq!(finished.turns, 14);
    state.close_session(session).await.unwrap();
}
