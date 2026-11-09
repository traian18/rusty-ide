//! The message shape flowing from a running rusty-core session back to the
//! IDE, over `HostBridge`'s outbound channel and (from Milestone B2) a
//! Tauri IPC `Channel`.

use rusty_protocol::events::AgentEventEnvelope;
use rusty_runtime::session_runtime::LifecycleRecovery;
use serde::Serialize;

/// The result of recovering an open session's retained compaction lifecycle events.
#[derive(Debug, Clone, Serialize)]
pub struct LifecycleRecoveryWire {
    /// `complete`: `envelopes` holds every retained lifecycle event after the cursor.
    /// `unavailable`: the session closed and nothing can be recovered.
    pub status: &'static str,
    pub envelopes: Vec<AgentEventEnvelope>,
    /// The cursor to recover from next time (absent when unavailable).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub high_water: Option<u64>,
}

impl From<LifecycleRecovery> for LifecycleRecoveryWire {
    fn from(recovery: LifecycleRecovery) -> Self {
        match recovery {
            LifecycleRecovery::Recovered {
                envelopes,
                high_water,
            } => Self {
                status: "complete",
                envelopes,
                high_water: Some(high_water),
            },
            LifecycleRecovery::Unavailable => Self {
                status: "unavailable",
                envelopes: Vec::new(),
                high_water: None,
            },
        }
    }
}

/// One message the Rust side of the bridge sends to the frontend for a
/// given session.
// Nearly every message is an `Event` (one per session event), so boxing the
// large variant would add an allocation per event and save nothing.
#[allow(clippy::large_enum_variant)]
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "kind", content = "data", rename_all = "snake_case")]
pub enum BridgeEvent {
    /// A durable or ephemeral event forwarded verbatim from the session's
    /// own `broadcast::Receiver<AgentEventEnvelope>`.
    Event(AgentEventEnvelope),
    /// The pump's `broadcast::Receiver` lagged and tokio dropped `dropped`
    /// events before the pump could read them. `last_delivered_sequence`
    /// is the last `session_sequence` this pump successfully forwarded
    /// before the gap (`None` if none yet) -- the frontend's own
    /// `client.sequence_gap`-style diagnostic (mirroring
    /// agentHarnessClient.ts's own gap handling for the sidecar path).
    Gap {
        last_delivered_sequence: Option<u64>,
        dropped: u64,
    },
    /// Compaction lifecycle events the session retained, recovered after a `Gap` so the chat can
    /// show the ones the lag dropped (it skips those it already has, by event id).
    LifecycleRecovery(LifecycleRecoveryWire),
    /// The session's tool code is asking the host (the IDE) to perform
    /// `tool` with `input`, and will await the matching
    /// `HostBridge::complete(call_id, ...)`.
    HostToolCall {
        call_id: String,
        tool: String,
        input: serde_json::Value,
        /// The model-facing tool call this host request serves (the
        /// `ToolCallRequested` event's `call.id`), when it was issued from
        /// inside a runtime tool execution. Lets the IDE attribute its own
        /// work -- e.g. a delegated model -- to that call's observability
        /// record. Distinct from `call_id`, which is the bridge's own
        /// request/answer correlation key.
        #[serde(skip_serializing_if = "Option::is_none")]
        tool_call_id: Option<String>,
        /// The session whose agent requested the call. Usually this
        /// session; a workflow step's isolated session otherwise (steps share
        /// this session's tools), which is how the IDE files the call's own
        /// work under the step's `ToolCallRequested`. Answers still go to
        /// this session's bridge.
        #[serde(skip_serializing_if = "Option::is_none")]
        session_id: Option<String>,
    },
    /// `HostExecutionBackend::execute` is asking the host (the IDE) to run
    /// one model turn (`input` is an `ExecutionRequest`) and will await any
    /// number of `HostBridge::push_event(call_id, ...)` calls followed by
    /// exactly one `HostBridge::finish_stream(call_id, ...)` -- the
    /// streaming counterpart to `HostToolCall`/`complete`, needed because a
    /// model turn emits incremental events before its final result.
    HostExecuteCall {
        call_id: String,
        tool: String,
        input: serde_json::Value,
    },
    /// The bridge's event pump ended -- the session closed, or the pump
    /// task itself failed. No further `BridgeEvent`s will arrive for this
    /// session; a pending `HostToolCall` this session issued but never got
    /// an answer for is failed via `HostBridge::fail_all` at the same time.
    Closed { reason: String },
    /// A committed orchestration event of this session's workflow run (an
    /// `OrchestrationEventEnvelope`: `{ sequence, event: { type, .. }, .. }`).
    WorkflowEvent(serde_json::Value),
    /// A live agent event from one workflow step's isolated session.
    WorkflowAgentEvent {
        node_id: String,
        attempt: u32,
        envelope: AgentEventEnvelope,
    },
    /// The workflow run reached a terminal state; `state` is the final
    /// `OrchestrationRunState` (status, steps, final_output, error, usage).
    WorkflowFinished { state: serde_json::Value },
}
