//! `HostBridge`: the mpsc/oneshot machinery connecting one running
//! session's tool calls -- and its own event stream, via the pump in
//! `mod.rs` -- to the IDE.
//!
//! One `HostBridge` per session, shared (`Arc`) between the session's
//! event-pump task, its `HostWorkspace`, and every `HostToolExecutor`
//! registered into its tool registry.

use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;

use harness_protocol::backend::{ExecutionError, ExecutionEvent, ExecutionResult};
use serde_json::Value;
use tokio::sync::{mpsc, oneshot};
use tokio_util::sync::CancellationToken;

use super::bridge_event::BridgeEvent;

/// One message the IDE can deliver against a `call_streaming` call: any
/// number of `Event`s, followed by exactly one terminal `Result`. Mirrors
/// `ExecutionBackend::execute`'s own shape (`harness-runtime::traits`) --
/// this is what lets `HostExecutionBackend::execute` sit on the other end
/// without any translation beyond routing.
pub enum StreamMessage {
    Event(ExecutionEvent),
    Result(Result<ExecutionResult, ExecutionError>),
}

pub struct HostBridge {
    outbound: mpsc::UnboundedSender<BridgeEvent>,
    pending: Mutex<HashMap<String, oneshot::Sender<Result<Value, String>>>>,
    /// A second, parallel correlation table for `call_streaming` --
    /// deliberately not reusing `pending` (a `oneshot::Sender` cannot
    /// deliver more than one value, and `HostWorkspace`/`HostToolExecutor`
    /// have no reason to pay for `mpsc` bookkeeping their one-shot calls
    /// don't need).
    pending_streams: Mutex<HashMap<String, mpsc::UnboundedSender<StreamMessage>>>,
    next_call_id: AtomicU64,
}

impl HostBridge {
    pub fn new(outbound: mpsc::UnboundedSender<BridgeEvent>) -> Self {
        Self {
            outbound,
            pending: Mutex::new(HashMap::new()),
            pending_streams: Mutex::new(HashMap::new()),
            next_call_id: AtomicU64::new(1),
        }
    }

    /// Sends `event` to the IDE. Silently drops it if the receiving end
    /// (the session's event pump / Tauri forwarding) has already gone away
    /// -- there is nothing further this call can do about that.
    pub fn emit(&self, event: BridgeEvent) {
        let _ = self.outbound.send(event);
    }

    /// Asks the IDE to run `tool` with `input`, waiting for the matching
    /// `complete(call_id, ...)` or for `cancel` to fire first.
    ///
    /// Returns `Err(reason)` if cancelled, if the pending entry was
    /// dropped without an answer (the bridge itself closing), or if the
    /// outbound channel's receiver is already gone.
    pub async fn call(
        &self,
        tool: &str,
        input: Value,
        cancel: &CancellationToken,
    ) -> Result<Value, String> {
        let call_id = format!("host-{}", self.next_call_id.fetch_add(1, Ordering::Relaxed));
        let (tx, rx) = oneshot::channel();
        self.pending.lock().unwrap().insert(call_id.clone(), tx);

        let sent = self.outbound.send(BridgeEvent::HostToolCall {
            call_id: call_id.clone(),
            tool: tool.to_string(),
            input,
        });
        if sent.is_err() {
            self.pending.lock().unwrap().remove(&call_id);
            return Err("host bridge is closed".to_string());
        }

        tokio::select! {
            result = rx => result.unwrap_or_else(|_| {
                Err("host bridge dropped the pending call without an answer".to_string())
            }),
            _ = cancel.cancelled() => {
                self.pending.lock().unwrap().remove(&call_id);
                Err("cancelled".to_string())
            }
        }
    }

    /// Delivers the IDE's answer for a previously issued `call`. A
    /// `call_id` with no matching pending entry (already answered,
    /// cancelled, or never issued by this bridge) is silently ignored --
    /// matching `respondToRpc`'s own "duplicate/late response" tolerance
    /// on the sidecar side of the contract.
    pub fn complete(&self, call_id: &str, result: Result<Value, String>) {
        if let Some(tx) = self.pending.lock().unwrap().remove(call_id) {
            let _ = tx.send(result);
        }
    }

    /// Like `call`, but the IDE may deliver any number of
    /// `StreamMessage::Event`s before exactly one terminal
    /// `StreamMessage::Result` -- the shape `ExecutionBackend::execute`
    /// needs (a streamed model turn), which a `oneshot`-backed `call()`
    /// cannot express. Returns immediately with the `call_id` (already
    /// emitted as a `BridgeEvent::HostExecuteCall`) and a receiver the
    /// caller drains until the terminal message arrives; unlike `call`,
    /// this does not await anything itself -- the caller owns the
    /// cancellation race (see `HostExecutionBackend::execute`).
    pub fn call_streaming(&self, tool: &str, input: Value) -> (String, mpsc::UnboundedReceiver<StreamMessage>) {
        let call_id = format!("host-{}", self.next_call_id.fetch_add(1, Ordering::Relaxed));
        let (tx, rx) = mpsc::unbounded_channel();
        self.pending_streams.lock().unwrap().insert(call_id.clone(), tx);
        self.emit(BridgeEvent::HostExecuteCall {
            call_id: call_id.clone(),
            tool: tool.to_string(),
            input,
        });
        (call_id, rx)
    }

    /// Delivers one interim event for a still-open `call_streaming` call.
    /// A `call_id` with no matching pending entry (already finished, or
    /// never issued by this bridge) is silently ignored -- same tolerance
    /// as `complete`.
    pub fn push_event(&self, call_id: &str, event: ExecutionEvent) {
        if let Some(tx) = self.pending_streams.lock().unwrap().get(call_id) {
            let _ = tx.send(StreamMessage::Event(event));
        }
    }

    /// Delivers the terminal result for a `call_streaming` call and
    /// removes the pending entry -- mirrors `complete`'s remove-then-send,
    /// so a second `finish_stream` for the same `call_id` is a silent
    /// no-op rather than a panic.
    pub fn finish_stream(&self, call_id: &str, result: Result<ExecutionResult, ExecutionError>) {
        if let Some(tx) = self.pending_streams.lock().unwrap().remove(call_id) {
            let _ = tx.send(StreamMessage::Result(result));
        }
    }

    /// Fails every currently pending call -- one-shot and streaming alike
    /// -- with `reason`. Called when the session itself closes, so no
    /// `call()`/`call_streaming()` await is left hanging forever.
    pub fn fail_all(&self, reason: &str) {
        let pending: Vec<_> = self.pending.lock().unwrap().drain().collect();
        for (_, tx) in pending {
            let _ = tx.send(Err(reason.to_string()));
        }
        let pending_streams: Vec<_> = self.pending_streams.lock().unwrap().drain().collect();
        for (_, tx) in pending_streams {
            let _ = tx.send(StreamMessage::Result(Err(ExecutionError::BackendError {
                message: reason.to_string(),
                code: "HOST_BRIDGE_CLOSED".to_string(),
            })));
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn bridge() -> (HostBridge, mpsc::UnboundedReceiver<BridgeEvent>) {
        let (tx, rx) = mpsc::unbounded_channel();
        (HostBridge::new(tx), rx)
    }

    #[tokio::test]
    async fn call_resolves_with_the_ides_answer() {
        let (bridge, mut outbound) = bridge();
        let cancel = CancellationToken::new();

        let call_future = bridge.call("workspace.read", serde_json::json!({"path": "/a.txt"}), &cancel);
        tokio::pin!(call_future);

        // Drive the call up to the point it has sent its HostToolCall and
        // is awaiting the answer, then answer it out-of-band, matching how
        // a real IDE round trip works: the request goes out over the
        // outbound channel; the answer comes back through `complete`.
        let event = tokio::select! {
            event = outbound.recv() => event.expect("bridge emitted a HostToolCall"),
            _ = &mut call_future => panic!("call resolved before it was answered"),
        };
        let BridgeEvent::HostToolCall { call_id, tool, input } = event else {
            panic!("expected a HostToolCall event");
        };
        assert_eq!(tool, "workspace.read");
        assert_eq!(input, serde_json::json!({"path": "/a.txt"}));

        bridge.complete(&call_id, Ok(serde_json::json!({"content": "hello"})));

        let result = call_future.await;
        assert_eq!(result, Ok(serde_json::json!({"content": "hello"})));
    }

    #[tokio::test]
    async fn cancel_unblocks_a_pending_call() {
        let (bridge, mut outbound) = bridge();
        let cancel = CancellationToken::new();

        let call_future = bridge.call("shell.exec", serde_json::json!({}), &cancel);
        tokio::pin!(call_future);

        // Drain the HostToolCall so we know the pending entry exists, then
        // cancel instead of ever answering it.
        let event = tokio::select! {
            event = outbound.recv() => event,
            _ = &mut call_future => None,
        };
        assert!(matches!(event, Some(BridgeEvent::HostToolCall { .. })));

        cancel.cancel();
        let result = tokio::time::timeout(std::time::Duration::from_secs(1), call_future)
            .await
            .expect("cancel must unblock the call promptly, not hang");
        assert_eq!(result, Err("cancelled".to_string()));
    }

    #[tokio::test]
    async fn complete_with_an_unknown_call_id_is_a_silent_no_op() {
        let (bridge, _outbound) = bridge();
        // Must not panic.
        bridge.complete("never-issued", Ok(serde_json::json!(null)));
    }

    #[tokio::test]
    async fn fail_all_unblocks_every_pending_call_with_the_given_reason() {
        let (bridge, mut outbound) = bridge();
        let cancel = CancellationToken::new();

        let first = bridge.call("a", serde_json::json!({}), &cancel);
        let second = bridge.call("b", serde_json::json!({}), &cancel);
        tokio::pin!(first);
        tokio::pin!(second);

        for _ in 0..2 {
            tokio::select! {
                _ = outbound.recv() => {}
                _ = &mut first => panic!("resolved too early"),
                _ = &mut second => panic!("resolved too early"),
            }
        }

        bridge.fail_all("session closed");

        assert_eq!(first.await, Err("session closed".to_string()));
        assert_eq!(second.await, Err("session closed".to_string()));
    }

    #[tokio::test]
    async fn call_fails_immediately_once_the_outbound_receiver_is_gone() {
        let (tx, rx) = mpsc::unbounded_channel();
        drop(rx);
        let bridge = HostBridge::new(tx);
        let cancel = CancellationToken::new();

        let result = bridge.call("workspace.read", serde_json::json!({}), &cancel).await;
        assert_eq!(result, Err("host bridge is closed".to_string()));
    }
}
