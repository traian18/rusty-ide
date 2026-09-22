//! The message shape flowing from a running rusty-core session back to the
//! IDE, over `HostBridge`'s outbound channel and (from Milestone B2) a
//! Tauri IPC `Channel`.

use harness_protocol::events::AgentEventEnvelope;
use serde::Serialize;

/// One message the Rust side of the bridge sends to the frontend for a
/// given session.
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
    /// The session's tool code is asking the host (the IDE) to perform
    /// `tool` with `input`, and will await the matching
    /// `HostBridge::complete(call_id, ...)`.
    HostToolCall {
        call_id: String,
        tool: String,
        input: serde_json::Value,
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
}
