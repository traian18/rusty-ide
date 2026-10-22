//! The seeded starter flow as a user would get it: profiles loaded from
//! `.rusty/profiles`, Plan's result handed to Build, and Verify checking on
//! disk that the file Build claims to have changed exists.

use std::path::{Path, PathBuf};

use super::*;

#[tokio::test]
async fn the_starter_flow_plans_builds_and_verifies() {
    run_starter_flow(false).await;
}

#[tokio::test]
async fn the_starter_flow_rejects_blocked_and_retries_build_with_the_plan() {
    run_starter_flow(true).await;
}

/// A workspace with the starter's Plan and Build profiles and a crate to edit.
fn seed_workspace() -> PathBuf {
    let root = std::env::temp_dir().join(format!("rusty-starter-flow-{}", uuid_like()));
    std::fs::create_dir_all(root.join(".rusty/profiles")).unwrap();
    std::fs::create_dir_all(root.join("src")).unwrap();
    std::fs::write(
        root.join(".rusty/profiles/plan.json"),
        starter_file!("v2/plan.profile.json"),
    )
    .unwrap();
    std::fs::write(
        root.join(".rusty/profiles/build.json"),
        starter_file!("v2/build.profile.json"),
    )
    .unwrap();
    std::fs::write(root.join("src/lib.rs"), "pub fn answer() -> u32 { 42 }\n").unwrap();
    root
}

fn starter_recipe(root: &Path) -> Value {
    json!({
        "workspace": { "root": root, "binding": "disk" },
        "integration": "host",
        "host_tools": [
            { "name": "read_file", "description": "Read a file" },
            { "name": "write_file", "description": "Write a file" },
            { "name": "list_files", "description": "List files" },
        ],
        "workflow": starter(starter_file!("v2/plan-build-verify.workflow.json")),
    })
}

fn plan() -> Value {
    json!({
        "summary": "Add answer()",
        "steps": [{ "title": "Add the function", "detail": "Edit src/lib.rs" }],
        "filesToChange": ["src/lib.rs"],
        "risks": []
    })
}

fn built() -> Value {
    json!({
        "summary": "Added answer()",
        "status": "completed",
        "artifacts": [{ "kind": "file", "reference": "src/lib.rs" }],
        "claimsToVerify": []
    })
}

fn blocked() -> Value {
    json!({
        "summary": "Validation requires an unavailable dependency",
        "status": "blocked",
        "artifacts": [],
        "claimsToVerify": ["Install the required dependency before validation"]
    })
}

/// One scripted model turn per step-turn, numbered from 1: Plan looks
/// around, then plans; Build reads, edits, checks its edit, then reports.
fn starter_reply(turn: usize, blocked_first: bool) -> Turn {
    let call = |name: &str, arguments: Value| Some(tool(name, arguments));
    let scripted = match turn {
        1 => call("list_files", json!({ "path": "." })),
        3 | 5 | 7 => call("read_file", json!({ "path": "src/lib.rs" })),
        4 => call(
            "write_file",
            json!({ "path": "src/lib.rs", "content": "pub fn answer() -> u32 { 42 }\n" }),
        ),
        _ => None,
    };
    scripted.unwrap_or_else(|| {
        let reply = match turn {
            2 => plan(),
            6 if blocked_first => blocked(),
            _ => built(),
        };
        text(reply.to_string())
    })
}

async fn run_starter_flow(blocked_first: bool) {
    let root = seed_workspace();
    let state = HarnessState::new();
    let (session_id, mut inbox) = start(
        &state,
        &starter_recipe(&root),
        json!({ "request": "add answer()" }),
    )
    .await;

    let mut offered = Vec::new();
    let tool_output = json!({ "content": "ok" });
    let finished = run_to_finish(
        &state,
        session_id,
        &mut inbox,
        tool_output,
        |turn, input| {
            offered.push(input.clone());
            starter_reply(turn + 1, blocked_first)
        },
    )
    .await;

    assert_eq!(finished.state["status"], "completed", "{}", finished.state);
    assert_eq!(finished.state["final_output"], built());
    let started: Vec<_> = finished
        .events
        .iter()
        .filter(|envelope| envelope["event"]["type"] == "step_started")
        .map(|envelope| envelope["event"]["node_id"].as_str().unwrap_or_default())
        .collect();
    let expected = if blocked_first {
        vec![
            "input", "plan", "build", "verify", "build", "verify", "output",
        ]
    } else {
        vec!["input", "plan", "build", "verify", "output"]
    };
    assert_eq!(started, expected);
    assert_eq!(finished.turns, if blocked_first { 8 } else { 6 });

    // Verify the actual model request, not merely the graph edge: every
    // Build turn must retain the complete structured handoff from Plan.
    for turn in 3..=finished.turns {
        assert_build_keeps_the_plan(turn, &offered[turn - 1]);
    }
    assert_only_build_may_edit(&offered);

    state.close_session(session_id).await.unwrap();
    // Best-effort cleanup of a temporary directory.
    let _ = std::fs::remove_dir_all(&root);
}

/// The user message carrying a Build turn's workflow input, and the handoff
/// inside it.
fn workflow_input(request: &Value) -> (&str, &str) {
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
    (prompt, handoff)
}

fn assert_build_keeps_the_plan(turn: usize, request: &Value) {
    let (prompt, handoff) = workflow_input(request);
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

/// Plan is read-only: it is never even offered a tool that edits or runs.
/// Build is offered the full set.
fn assert_only_build_may_edit(offered: &[Value]) {
    let plan_tools = offered[0].to_string();
    assert!(
        !plan_tools.contains("write_file"),
        "Plan must not be offered write_file"
    );
    assert!(
        plan_tools.contains("list_files"),
        "Plan keeps its read tools"
    );
    assert!(
        offered[2].to_string().contains("write_file"),
        "Build is offered write_file"
    );
}
