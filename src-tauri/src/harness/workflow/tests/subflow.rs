//! A workflow may run another (built-in or saved) as a subflow.

use super::*;

/// input → sub (a subflow of `target`) → output.
fn calling(target: Value) -> Value {
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

/// Starts the calling workflow in a workspace that has `saved` in
/// `.rusty/workflows`.
async fn start_calling(target: Value, saved: Vec<Value>) -> Result<(), String> {
    let workspace = tempfile::tempdir().unwrap();
    let dir = workspace.path().join(".rusty/workflows");
    std::fs::create_dir_all(&dir).unwrap();
    for document in &saved {
        let file = dir.join(format!("{}.json", document["id"].as_str().unwrap()));
        std::fs::write(file, document.to_string()).unwrap();
    }
    let state = HarnessState::new();
    let recipe: SessionRecipe = serde_json::from_value(json!({
        "workspace": { "root": workspace.path(), "binding": "host" },
        "integration": "host",
        "workflow": calling(target),
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
async fn a_workflow_may_run_a_workflow_saved_in_the_workspace() {
    let mut helper = harness_engine::validation::templates().default_workflow;
    helper["id"] = json!("ws.helper");
    helper["status"] = json!("draft");
    start_calling(json!({ "type": "flow", "id": "ws.helper" }), vec![helper])
        .await
        .expect("the workspace's saved workflows are in the catalog");
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
