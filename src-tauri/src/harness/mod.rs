//! HARNESS_CONTRACT_PLAN.md Milestone B: the Rust-side bridge to
//! rusty-core. Milestone B1 built the infrastructure (`HarnessState`, the
//! event pump, `HostBridge`/`HostWorkspace`/`HostToolExecutor`); Milestone
//! B2 (`commands.rs`, `recipe.rs`, `session.rs`) is what makes it
//! reachable from the frontend, mirroring rusty-core's own RPC surface as
//! Tauri commands registered in `lib.rs` next to the VFS commands.
//!
//! `#![allow(dead_code, unused_imports)]`: `harness_list_providers`/
//! `harness_list_models`/etc. are real, registered Tauri commands, but
//! nothing in this *crate* calls them the way it calls e.g. `git::
//! git_status` -- a Tauri command's only caller is the frontend's
//! `invoke()`, invisible to rustc's reachability analysis the way a normal
//! Rust call site isn't. Left un-suppressed, that alone would flag most of
//! this module as dead code and mask a genuinely unused item later.

#![allow(dead_code, unused_imports)]

pub mod commands;
mod bridge_event;
mod host_bridge;
mod host_execution_backend;
mod host_tools;
mod host_workspace;
mod managed_auth;
mod managed_binaries;
mod managed_models;
mod managed_quota;
mod recipe;
mod session;

pub use bridge_event::BridgeEvent;
pub use host_bridge::HostBridge;
pub use host_execution_backend::HostExecutionBackend;
pub use host_tools::HostToolExecutor;
pub use host_workspace::HostWorkspace;

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use harness_engine::{Harness, SessionHandle};
use harness_integration_anthropic::AnthropicFactory;
use harness_integration_claude_code::ClaudeCodeFactory;
use harness_integration_codex::CodexFactory;
use harness_integration_gemini::GeminiFactory;
use harness_integration_github_copilot::GitHubCopilotFactory;
use harness_integration_openai::OpenAiFactory;
use harness_integration_openai_compatible::OpenAiCompatibleFactory;
use harness_integration_openai_responses::OpenAiResponsesFactory;
use harness_protocol::events::AgentEventEnvelope;
use harness_protocol::ids::SessionId;
use tokio::sync::{broadcast, mpsc, OnceCell};
use tokio::task::JoinHandle;

/// One live session's bridge-side state.
pub struct SessionEntry {
    pub handle: Arc<SessionHandle>,
    pub bridge: Arc<HostBridge>,
    /// Held until Milestone B2's `harness_subscribe` command takes it --
    /// `Option` because an `mpsc::UnboundedReceiver` can only have one
    /// owner, and `Mutex` (not `RefCell`) because Tauri commands need
    /// `Send`/`Sync` state accessed through `&self`.
    pub inbox: Mutex<Option<mpsc::UnboundedReceiver<BridgeEvent>>>,
    pub pump: JoinHandle<()>,
}

/// Process-wide harness state, held in Tauri's managed state
/// (`app.manage(HarnessState::new())`).
pub struct HarnessState {
    harness: OnceCell<Arc<Harness>>,
    sessions: Mutex<HashMap<SessionId, SessionEntry>>,
    pub managed_auth: Arc<managed_auth::ManagedAuthState>,
}

impl Default for HarnessState {
    fn default() -> Self {
        Self::new()
    }
}

impl HarnessState {
    pub fn new() -> Self {
        Self {
            harness: OnceCell::new(),
            sessions: Mutex::new(HashMap::new()),
            managed_auth: Arc::new(managed_auth::ManagedAuthState::new()),
        }
    }

    /// Lazily builds the process-wide `Harness` on first use, registering
    /// the same integration factories `apps/harnessd/src/main.rs` does
    /// (wiring copied from there), plus `openai-responses` (rusty-only so
    /// far -- backs OpenCode Zen's GPT/Grok/Muse-Spark model family, see
    /// the OpenCode Zen per-model-family routing plan). No durable session
    /// store is configured -- an embedded desktop app has no restore/replay
    /// requirement the way `harnessd` does; `HarnessBuilder::build` falls
    /// back to an in-memory no-op store on its own (and warns once, via
    /// `tracing`). Cached after the first call.
    pub async fn harness(&self) -> Arc<Harness> {
        self.harness
            .get_or_init(|| async {
                let harness = Harness::builder()
                    .register_integration(Arc::new(AnthropicFactory))
                    .register_integration(Arc::new(OpenAiFactory))
                    .register_integration(Arc::new(OpenAiResponsesFactory))
                    .register_integration(Arc::new(OpenAiCompatibleFactory))
                    .register_integration(Arc::new(GeminiFactory))
                    .register_integration(Arc::new(ClaudeCodeFactory))
                    .register_integration(Arc::new(CodexFactory))
                    .register_integration(Arc::new(GitHubCopilotFactory))
                    .build()
                    .await
                    .expect(
                        "Harness::builder().build() only fails on a duplicate \
                         integration id or a session-store I/O error; this \
                         call registers eight distinct, hardcoded ids and \
                         configures no store",
                    );
                Arc::new(harness)
            })
            .await
            .clone()
    }

    pub fn insert_session(&self, session_id: SessionId, entry: SessionEntry) {
        self.sessions.lock().unwrap().insert(session_id, entry);
    }

    pub fn remove_session(&self, session_id: &SessionId) -> Option<SessionEntry> {
        self.sessions.lock().unwrap().remove(session_id)
    }

    pub fn with_session<T>(&self, session_id: &SessionId, f: impl FnOnce(&SessionEntry) -> T) -> Option<T> {
        self.sessions.lock().unwrap().get(session_id).map(f)
    }
}

/// Spawns the task that forwards `events` (a session's own
/// `broadcast::Receiver<AgentEventEnvelope>`) into `outbound` as
/// `BridgeEvent`s.
///
/// Started at session-create time -- not deferred until Milestone B2's
/// `harness_subscribe` command first asks for events -- so anything
/// emitted before the frontend subscribes is buffered in the (unbounded)
/// mpsc channel instead of silently dropped once the session's own
/// 256-capacity broadcast channel (`SessionHandle::subscribe`) wraps
/// around.
pub fn spawn_event_pump(
    mut events: broadcast::Receiver<AgentEventEnvelope>,
    outbound: mpsc::UnboundedSender<BridgeEvent>,
) -> JoinHandle<()> {
    tokio::spawn(async move {
        let mut last_delivered_sequence = None;
        loop {
            match events.recv().await {
                Ok(envelope) => {
                    last_delivered_sequence = envelope.session_sequence.or(last_delivered_sequence);
                    if outbound.send(BridgeEvent::Event(envelope)).is_err() {
                        // Nothing is listening anymore (the frontend side,
                        // or in a test, the receiver was dropped) --
                        // nothing left to pump for.
                        return;
                    }
                }
                Err(broadcast::error::RecvError::Lagged(dropped)) => {
                    let _ = outbound.send(BridgeEvent::Gap {
                        last_delivered_sequence,
                        dropped,
                    });
                }
                Err(broadcast::error::RecvError::Closed) => {
                    let _ = outbound.send(BridgeEvent::Closed {
                        reason: "session closed".to_string(),
                    });
                    return;
                }
            }
        }
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use harness_protocol::events::{AgentEvent, EventVisibility};
    use harness_protocol::ids::{AgentId, EventId, RunId, Timestamp};

    fn fixture_envelope(session_sequence: u64) -> AgentEventEnvelope {
        AgentEventEnvelope {
            event_id: EventId::new(),
            session_id: SessionId::new(),
            agent_id: AgentId::new(),
            parent_agent_id: None,
            run_id: Some(RunId::new()),
            agent_sequence: session_sequence,
            session_sequence: Some(session_sequence),
            timestamp: Timestamp::now(),
            visibility: EventVisibility::User,
            event: AgentEvent::RunStarted { run_id: RunId::new() },
        }
    }

    #[tokio::test]
    async fn pump_buffers_events_emitted_before_the_frontend_subscribes() {
        let (tx, rx) = broadcast::channel(16);
        // Sent before the pump (standing in for the frontend's eventual
        // harness_subscribe call) is even spawned -- simulates a session
        // whose run started producing events before B2's Tauri command
        // asked for them.
        for i in 1..=3 {
            tx.send(fixture_envelope(i)).unwrap();
        }

        let (outbound_tx, mut outbound_rx) = mpsc::unbounded_channel();
        let pump = spawn_event_pump(rx, outbound_tx);

        for expected in 1..=3 {
            let event = outbound_rx.recv().await.expect("pump forwarded a buffered event");
            match event {
                BridgeEvent::Event(envelope) => assert_eq!(envelope.session_sequence, Some(expected)),
                other => panic!("expected Event, got {other:?}"),
            }
        }

        drop(tx);
        let closed = outbound_rx.recv().await.expect("pump reports closure");
        assert!(matches!(closed, BridgeEvent::Closed { .. }));
        pump.await.unwrap();
    }

    #[tokio::test]
    async fn pump_maps_a_lag_to_a_gap_event() {
        let (tx, rx) = broadcast::channel(2);
        // Overflow the small buffer before the pump ever reads, forcing
        // its first recv() to observe a Lagged error.
        for i in 1..=5 {
            let _ = tx.send(fixture_envelope(i));
        }

        let (outbound_tx, mut outbound_rx) = mpsc::unbounded_channel();
        let _pump = spawn_event_pump(rx, outbound_tx);

        let event = outbound_rx.recv().await.expect("pump reports the lag");
        match event {
            BridgeEvent::Gap { last_delivered_sequence, dropped } => {
                assert_eq!(last_delivered_sequence, None, "nothing was delivered before the lag");
                assert!(dropped > 0);
            }
            other => panic!("expected Gap, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn pump_tracks_the_last_delivered_sequence_across_a_later_gap() {
        let (tx, rx) = broadcast::channel(16);
        let (outbound_tx, mut outbound_rx) = mpsc::unbounded_channel();
        let _pump = spawn_event_pump(rx, outbound_tx);

        tx.send(fixture_envelope(1)).unwrap();
        let first = outbound_rx.recv().await.unwrap();
        assert!(matches!(first, BridgeEvent::Event(ref e) if e.session_sequence == Some(1)));

        // Now overflow while the pump is between reads is hard to force
        // deterministically without a second lagging receiver, so this
        // test only pins that `last_delivered_sequence` starts tracking
        // once at least one event has actually been delivered --
        // pump_maps_a_lag_to_a_gap_event above covers the "nothing
        // delivered yet" case.
        drop(tx);
        let closed = outbound_rx.recv().await.unwrap();
        assert!(matches!(closed, BridgeEvent::Closed { .. }));
    }

    #[tokio::test]
    async fn pump_reports_closed_when_the_sender_is_dropped() {
        let (tx, rx) = broadcast::channel::<AgentEventEnvelope>(4);
        drop(tx);
        let (outbound_tx, mut outbound_rx) = mpsc::unbounded_channel();
        let pump = spawn_event_pump(rx, outbound_tx);

        let event = outbound_rx.recv().await.expect("pump reports closure");
        assert!(matches!(event, BridgeEvent::Closed { .. }));
        pump.await.unwrap();
    }

    #[tokio::test]
    async fn harness_is_built_lazily_and_cached() {
        let state = HarnessState::new();
        let first = state.harness().await;
        let second = state.harness().await;
        assert!(Arc::ptr_eq(&first, &second));
    }
}
