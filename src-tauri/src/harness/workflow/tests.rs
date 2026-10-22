//! Workflow runs on host-bridge sessions. The model and the host tools are
//! scripted: each test answers the bridge's `HostExecuteCall` and
//! `HostToolCall` events the way the IDE would, through the helpers here.

use std::time::Duration;

use harness_protocol::backend::{ExecutionError, ExecutionEvent, ExecutionResult};
use harness_protocol::ids::RequestId;
use harness_protocol::tools::ToolCall;
use harness_protocol::usage::{Cost, ModelUsage};
use serde_json::{json, Value};

use super::super::recipe::SessionRecipe;
use super::*;

/// A starter document shipped with the app, by its path under `legacy/`.
macro_rules! starter_file {
    ($path:literal) => {
        include_str!(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../src/components/tabs/behaviors/starter/legacy/",
            $path
        ))
    };
}

mod approval;
mod build_loop;
mod catalog;
mod host_bridge;
mod stage_flow;
mod starter_flow;
mod subflow;

// Historical transport/retry fixtures. Active catalog validation reads the generated manifest.
const STARTER_WORKFLOW: &str = starter_file!("before-task-queue/plan-build-verify.workflow.json");
const INVESTIGATE_WORKFLOW: &str = starter_file!("before-task-queue/investigate.workflow.json");

fn report() -> Value {
    json!({ "summary": "done", "status": "completed", "artifacts": [], "claimsToVerify": [] })
}

/// The default workflow, with its agent step accepting JSON text: the
/// host-routed backend has no native structured output.
fn workflow_document() -> Value {
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

fn starter(text: &str) -> Value {
    serde_json::from_str(text).expect("a starter document is valid JSON")
}

/// Points every step at the built-in profile of the same name, so no
/// workspace profile files are needed.
fn with_builtin_profiles(mut document: Value) -> Value {
    for node in document["nodes"].as_array_mut().unwrap() {
        if let Some(id) = node["config"]["profile"]["id"].as_str() {
            node["config"]["profile"]["id"] = json!(format!("rusty-ide.builtin.{id}"));
        }
    }
    document
}

/// The starter with only its first slice: Plan, Build, Verify and the gate.
/// The gate and loop tests are about one round of build and verify, not
/// about how the work is split.
fn one_slice(mut document: Value) -> Value {
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

/// A host-integration session recipe over `root` running `workflow`, offering
/// `tools` (name, description) as host tools.
fn host_recipe(root: impl serde::Serialize, workflow: Value, tools: &[(&str, &str)]) -> Value {
    let tools: Vec<_> = tools
        .iter()
        .map(|(name, description)| json!({ "name": name, "description": description }))
        .collect();
    json!({
        "workspace": { "root": root, "binding": "host" },
        "integration": "host",
        "host_tools": tools,
        "workflow": workflow,
    })
}

/// Creates a session from `recipe` and starts its workflow on `input`.
async fn start(
    state: &HarnessState,
    recipe: &Value,
    input: Value,
) -> (SessionId, mpsc::UnboundedReceiver<BridgeEvent>) {
    let recipe: SessionRecipe = serde_json::from_value(recipe.clone()).unwrap();
    let session = state
        .create_session(recipe)
        .await
        .expect("session with a workflow");
    let inbox = state.take_inbox(session).unwrap();
    state
        .start_workflow(session, input)
        .await
        .expect("run starts");
    (session, inbox)
}

async fn next_event_within(
    inbox: &mut mpsc::UnboundedReceiver<BridgeEvent>,
    wait: Duration,
) -> BridgeEvent {
    tokio::time::timeout(wait, inbox.recv())
        .await
        .expect("the run must not stall")
        .expect("the inbox stays open")
}

async fn next_event(inbox: &mut mpsc::UnboundedReceiver<BridgeEvent>) -> BridgeEvent {
    next_event_within(inbox, Duration::from_secs(5)).await
}

/// What the scripted model does on one turn.
enum Turn {
    Tool(ToolCall),
    Text(String),
    /// The backend fails the request.
    Fail(ExecutionError),
}

fn tool(name: &str, arguments: Value) -> Turn {
    Turn::Tool(ToolCall {
        id: harness_protocol::ids::ToolCallId::new(),
        name: name.into(),
        arguments,
    })
}

fn text(reply: impl Into<String>) -> Turn {
    Turn::Text(reply.into())
}

/// Answers one `HostExecuteCall` the way the IDE's model run would.
fn answer(state: &HarnessState, session: SessionId, call_id: &str, turn: Turn) {
    let request_id = RequestId::new();
    let (event, finish) = match turn {
        Turn::Fail(error) => {
            state
                .host_execute_result(session, call_id, Err(error))
                .unwrap();
            return;
        }
        Turn::Tool(call) => (
            ExecutionEvent::ToolCallRequested { request_id, call },
            "tool_use",
        ),
        Turn::Text(delta) => (ExecutionEvent::TextDelta { request_id, delta }, "end_turn"),
    };
    state.host_execute_event(session, call_id, event).unwrap();
    let result = ExecutionResult {
        request_id,
        usage: ModelUsage::default(),
        cost: Cost::default(),
        finish_reason: finish.into(),
    };
    state
        .host_execute_result(session, call_id, Ok(result))
        .unwrap();
}

/// How a scripted run ended.
struct Finished {
    state: Value,
    /// Model turns answered.
    turns: usize,
    /// The workflow events forwarded on the way, in order.
    events: Vec<Value>,
}

/// The scripted IDE side of a run: answers model turns with `reply` (given
/// the turn's number from 0 and its request) and every host tool call with
/// `tool_output`, until the run finishes.
async fn run_to_finish(
    state: &HarnessState,
    session: SessionId,
    inbox: &mut mpsc::UnboundedReceiver<BridgeEvent>,
    tool_output: Value,
    mut reply: impl FnMut(usize, &Value) -> Turn,
) -> Finished {
    let mut turns = 0;
    let mut events = Vec::new();
    loop {
        match next_event_within(inbox, Duration::from_secs(10)).await {
            BridgeEvent::HostExecuteCall { call_id, input, .. } => {
                answer(state, session, &call_id, reply(turns, &input));
                turns += 1;
            }
            BridgeEvent::HostToolCall { call_id, .. } => state
                .host_tool_result(session, &call_id, Ok(tool_output.clone()))
                .unwrap(),
            BridgeEvent::WorkflowEvent(envelope) => events.push(envelope),
            BridgeEvent::WorkflowFinished { state } => {
                return Finished {
                    state,
                    turns,
                    events,
                }
            }
            _ => {}
        }
    }
}

/// The text a model request carries, block by block.
fn prompt_text(input: &Value) -> String {
    input["messages"]
        .as_array()
        .unwrap()
        .iter()
        .flat_map(|message| message["content"].as_array().unwrap())
        .filter_map(|block| block["Text"]["text"].as_str())
        .collect::<Vec<_>>()
        .join("\n")
}

/// How many attempts a step of a finished run took.
fn attempts(checkpoint: &Value, step: &str) -> usize {
    checkpoint["steps"][step]["attempts"]
        .as_array()
        .unwrap()
        .len()
}
