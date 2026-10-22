//! Approval steps wait for an answer given through `workflow_control`.

use super::*;

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
        .start_workflow_from_checkpoint(session_id, json!({ "request": "ship it" }), None, options)
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
