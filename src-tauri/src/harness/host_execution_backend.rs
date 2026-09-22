//! `HostExecutionBackend`: an `ExecutionBackend` that forwards every model
//! turn to the IDE via `HostBridge` instead of calling a provider directly.
//!
//! This is the third "host-routed" trait implementation alongside
//! `HostWorkspace`/`HostToolExecutor` (same file layout, same reasoning for
//! living here rather than in a new rusty-core crate: it is pure glue with
//! no reuse value for a headless embedder like `apps/harnessd`, which has
//! no IDE to delegate to). Unlike those two, it is never registered as an
//! `IntegrationFactory` -- there is no provider config to resolve, and
//! rusty-core's `SessionBuilder::backend(Arc<dyn ExecutionBackend>)` (a
//! pre-existing, unmodified escape hatch) is handed one directly by
//! `recipe.rs::build_session_builder` instead of going through
//! `.integration(id, config)`.
//!
//! Every core-routed session takes this path (see recipe.rs) -- rusty-core
//! itself never resolves provider identity or credentials for an
//! IDE-embedded session; that now lives entirely on the IDE side of the
//! bridge (`CoreHarness.ts`'s `handleHostExecuteCall`).

use std::sync::Arc;

use async_trait::async_trait;
use harness_protocol::backend::{
    BackendCapabilities, BackendDescriptor, ExecutionError, ExecutionEvent, ExecutionRequest,
    ExecutionResult,
};
use harness_protocol::ids::BackendId;
use harness_runtime::traits::ExecutionBackend;
use tokio::sync::broadcast;
use tokio_util::sync::CancellationToken;

use super::host_bridge::{HostBridge, StreamMessage};

pub struct HostExecutionBackend {
    descriptor: BackendDescriptor,
    bridge: Arc<HostBridge>,
}

impl HostExecutionBackend {
    pub fn new(bridge: Arc<HostBridge>) -> Self {
        Self {
            descriptor: BackendDescriptor {
                id: BackendId::new(),
                name: "Host-routed".to_string(),
                description: "Forwards model execution to the IDE instead of calling a provider directly.".to_string(),
                capabilities: BackendCapabilities {
                    streaming: true,
                    tool_calls: true,
                    // The IDE, not this backend, decides which real
                    // provider answers a given call -- these flags are
                    // therefore a rough upper bound, not a precise
                    // per-provider fact, unlike the other seven
                    // integrations' own descriptors.
                    host_managed_tools: true,
                    ..Default::default()
                },
            },
            bridge,
        }
    }
}

#[async_trait]
impl ExecutionBackend for HostExecutionBackend {
    fn descriptor(&self) -> BackendDescriptor {
        self.descriptor.clone()
    }

    fn capabilities(&self) -> BackendCapabilities {
        self.descriptor.capabilities.clone()
    }

    async fn execute(
        &self,
        request: ExecutionRequest,
        sink: broadcast::Sender<ExecutionEvent>,
        cancel: CancellationToken,
    ) -> Result<ExecutionResult, ExecutionError> {
        let payload = serde_json::to_value(&request).map_err(|error| ExecutionError::BackendError {
            message: format!("failed to serialize ExecutionRequest: {error}"),
            code: "HOST_SERIALIZE_FAILED".to_string(),
        })?;
        let (_call_id, mut rx) = self.bridge.call_streaming("backend.execute", payload);

        loop {
            tokio::select! {
                message = rx.recv() => match message {
                    Some(StreamMessage::Event(event)) => {
                        // Nothing is listening (the sink's only receiver, if
                        // any, was dropped) -- not an error, the run itself
                        // still proceeds to whatever terminal message follows.
                        let _ = sink.send(event);
                    }
                    Some(StreamMessage::Result(result)) => return result,
                    None => {
                        return Err(ExecutionError::BackendError {
                            message: "host bridge dropped the pending stream without a terminal result".to_string(),
                            code: "HOST_STREAM_CLOSED".to_string(),
                        });
                    }
                },
                _ = cancel.cancelled() => return Err(ExecutionError::Cancelled),
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use harness_protocol::backend::{ExecutionParams, ExecutionResult};
    use harness_protocol::ids::{RequestId, RunId};
    use harness_protocol::usage::{Cost, ModelUsage};
    use tokio::sync::mpsc;

    use super::super::bridge_event::BridgeEvent;

    fn bridge() -> (Arc<HostBridge>, mpsc::UnboundedReceiver<BridgeEvent>) {
        let (tx, rx) = mpsc::unbounded_channel();
        (Arc::new(HostBridge::new(tx)), rx)
    }

    fn request() -> ExecutionRequest {
        ExecutionRequest {
            request_id: RequestId::new(),
            run_id: RunId::new(),
            system_prompt: "You are a test.".to_string(),
            messages: vec![],
            tools: vec![],
            extended_thinking: false,
            params: ExecutionParams::default(),
        }
    }

    #[tokio::test]
    async fn execute_forwards_streamed_events_then_resolves_with_the_terminal_result() {
        let (bridge, mut outbound) = bridge();
        let backend = HostExecutionBackend::new(bridge.clone());
        let (sink, mut events) = broadcast::channel(16);
        let cancel = CancellationToken::new();

        // Spawned, not polled manually via select! -- execute()'s own loop
        // (awaiting `rx.recv()`) must keep making progress concurrently
        // while this test drives `bridge` and reads from `events` below;
        // a `tokio::select!` that stops polling the future the moment the
        // HostExecuteCall arrives would leave it permanently un-driven,
        // and every push_event()/events.recv() after that would hang.
        let execute_handle = tokio::spawn(async move { backend.execute(request(), sink, cancel).await });

        let event = outbound.recv().await.expect("bridge emitted a HostExecuteCall");
        let BridgeEvent::HostExecuteCall { call_id, tool, .. } = event else {
            panic!("expected a HostExecuteCall event");
        };
        assert_eq!(tool, "backend.execute");

        bridge.push_event(&call_id, ExecutionEvent::TextDelta { request_id: RequestId::new(), delta: "Hel".to_string() });
        bridge.push_event(&call_id, ExecutionEvent::TextDelta { request_id: RequestId::new(), delta: "lo".to_string() });

        let first = events.recv().await.expect("first delta forwarded to the sink");
        assert!(matches!(first, ExecutionEvent::TextDelta { ref delta, .. } if delta == "Hel"));
        let second = events.recv().await.expect("second delta forwarded to the sink");
        assert!(matches!(second, ExecutionEvent::TextDelta { ref delta, .. } if delta == "lo"));

        let final_result = ExecutionResult {
            request_id: RequestId::new(),
            usage: ModelUsage::default(),
            cost: Cost::default(),
            finish_reason: "end_turn".to_string(),
        };
        bridge.finish_stream(&call_id, Ok(final_result.clone()));

        let outcome = execute_handle
            .await
            .expect("execute() task should not panic")
            .expect("execute() should resolve with the terminal result");
        assert_eq!(outcome.finish_reason, final_result.finish_reason);
    }

    #[tokio::test]
    async fn cancel_unblocks_execute_promptly() {
        let (bridge, mut outbound) = bridge();
        let backend = HostExecutionBackend::new(bridge.clone());
        let (sink, _events) = broadcast::channel(16);
        let cancel = CancellationToken::new();
        let cancel_handle = cancel.clone();

        let execute_future = backend.execute(request(), sink, cancel);
        tokio::pin!(execute_future);

        let event = tokio::select! {
            event = outbound.recv() => event,
            _ = &mut execute_future => None,
        };
        assert!(matches!(event, Some(BridgeEvent::HostExecuteCall { .. })));

        cancel_handle.cancel();
        let result = tokio::time::timeout(std::time::Duration::from_secs(1), execute_future)
            .await
            .expect("cancel must unblock execute() promptly, not hang");
        assert!(matches!(result, Err(ExecutionError::Cancelled)));
    }

    #[tokio::test]
    async fn a_second_finish_stream_for_the_same_call_is_a_silent_no_op() {
        let (bridge, _outbound) = bridge();
        let result = ExecutionResult {
            request_id: RequestId::new(),
            usage: ModelUsage::default(),
            cost: Cost::default(),
            finish_reason: "end_turn".to_string(),
        };
        // Must not panic.
        bridge.finish_stream("never-issued", Ok(result));
    }
}
