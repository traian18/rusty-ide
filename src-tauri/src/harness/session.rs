//! Session lifecycle: `HarnessState`'s async methods backing Milestone
//! B2's Tauri commands (`commands.rs`). Kept separate from the thin
//! `#[tauri::command]` wrappers so this logic is callable -- and testable
//! -- without a running Tauri app.

use std::sync::{Arc, Mutex};

use harness_protocol::ids::SessionId;
use harness_protocol::rpc::MutationCommand;
use tokio::sync::mpsc;

use super::recipe::{build_session_builder, SessionRecipe};
use super::{BridgeEvent, HarnessState, HostBridge, SessionEntry};

/// A serializable projection of rusty-core's own (non-`Serialize`)
/// `SessionSnapshot` -- just the fields a Milestone B consumer needs,
/// widened as later milestones ask for more.
#[derive(Debug, Clone, serde::Serialize)]
pub struct SessionSnapshotWire {
    pub session_id: String,
    pub status: String,
}

impl HarnessState {
    /// Builds and starts a new session from `recipe`, registers it, and
    /// returns its id. Spawns the event pump immediately (before returning)
    /// so nothing emitted between here and the frontend's first
    /// `harness_subscribe` call is lost.
    ///
    /// `managed_binary_path`: forwarded to `build_session_builder` --
    /// resolved by `commands.rs::harness_create_session`, the one caller
    /// with a real `AppHandle` (see `managed_binaries.rs`).
    pub async fn create_session(
        &self,
        recipe: SessionRecipe,
        managed_binary_path: Option<std::path::PathBuf>,
    ) -> Result<SessionId, String> {
        let harness = self.harness().await;
        let (outbound_tx, outbound_rx) = mpsc::unbounded_channel();
        let bridge = Arc::new(HostBridge::new(outbound_tx.clone()));

        let builder = build_session_builder(&harness, recipe, bridge.clone(), managed_binary_path).await.map_err(|error| error.to_string())?;
        let handle = builder.start().await.map_err(|error| error.to_string())?;
        let session_id = handle.session_id();

        let pump = super::spawn_event_pump(handle.subscribe(), outbound_tx);
        self.insert_session(
            session_id,
            SessionEntry {
                handle: Arc::new(handle),
                bridge,
                inbox: Mutex::new(Some(outbound_rx)),
                pump,
            },
        );
        Ok(session_id)
    }

    /// Takes this session's inbox -- can only succeed once per session
    /// (mirrors `contract/harness.ts`-shaped expectations: a session has
    /// exactly one subscriber). A second call, or a call for an unknown
    /// session, is an error rather than silently returning an empty
    /// channel the caller would wait on forever.
    pub fn take_inbox(&self, session_id: SessionId) -> Result<mpsc::UnboundedReceiver<BridgeEvent>, String> {
        let taken = self
            .with_session(&session_id, |entry| entry.inbox.lock().unwrap().take())
            .ok_or_else(|| "no such session".to_string())?;
        taken.ok_or_else(|| "session already has a subscriber".to_string())
    }

    /// Applies one mutation to a session's active run. `CloseSession`
    /// removes the session from the table too, matching
    /// `close_session`'s own behavior -- both paths exist because the
    /// wire vocabulary (`MutationCommand`) already has a `CloseSession`
    /// variant, and rejecting it here in favor of forcing every caller
    /// through the dedicated command would be a surprising, undocumented
    /// restriction on a type this module didn't define.
    pub async fn mutate(&self, session_id: SessionId, command: MutationCommand) -> Result<(), String> {
        let handle = self
            .with_session(&session_id, |entry| entry.handle.clone())
            .ok_or_else(|| "no such session".to_string())?;

        let result = match command {
            MutationCommand::Prompt(input) => handle.send_input(input).await,
            MutationCommand::Steer(input) => handle.steer_input(input).await,
            MutationCommand::FollowUp(input) => handle.follow_up_input(input).await,
            MutationCommand::Cancel => handle.cancel().await,
            MutationCommand::Pause => handle.pause().await,
            MutationCommand::Resume => handle.resume().await,
            MutationCommand::ResolvePermission { id, decision } => {
                handle.resolve_permission(id, decision).await
            }
            MutationCommand::CloseSession => {
                let outcome = handle.close().await;
                self.close_session(session_id).await.ok();
                outcome
            }
        };
        result.map_err(|error| error.to_string())
    }

    /// Delivers the IDE's answer for a previously issued `HostToolCall`
    /// (from a `harness_host_tool_result` Tauri command).
    pub fn host_tool_result(
        &self,
        session_id: SessionId,
        call_id: &str,
        result: Result<serde_json::Value, String>,
    ) -> Result<(), String> {
        self.with_session(&session_id, |entry| entry.bridge.complete(call_id, result))
            .ok_or_else(|| "no such session".to_string())
    }

    /// Delivers one interim `ExecutionEvent` for a still-open
    /// `HostExecuteCall` (from a `harness_host_execute_event` Tauri
    /// command).
    pub fn host_execute_event(
        &self,
        session_id: SessionId,
        call_id: &str,
        event: harness_protocol::backend::ExecutionEvent,
    ) -> Result<(), String> {
        self.with_session(&session_id, |entry| entry.bridge.push_event(call_id, event))
            .ok_or_else(|| "no such session".to_string())
    }

    /// Delivers the terminal result for a `HostExecuteCall` (from a
    /// `harness_host_execute_result` Tauri command).
    pub fn host_execute_result(
        &self,
        session_id: SessionId,
        call_id: &str,
        result: Result<harness_protocol::backend::ExecutionResult, harness_protocol::backend::ExecutionError>,
    ) -> Result<(), String> {
        self.with_session(&session_id, |entry| entry.bridge.finish_stream(call_id, result))
            .ok_or_else(|| "no such session".to_string())
    }

    pub fn session_snapshot(&self, session_id: SessionId) -> Result<SessionSnapshotWire, String> {
        self.with_session(&session_id, |entry| {
            let snapshot = entry.handle.snapshot();
            SessionSnapshotWire {
                session_id: snapshot.session_id.to_string(),
                status: format!("{:?}", snapshot.status),
            }
        })
        .ok_or_else(|| "no such session".to_string())
    }

    /// Closes and forgets a session: fails any host-tool call still
    /// awaiting an answer, stops the event pump, and asks rusty-core to
    /// close the underlying run. Safe to call on a session that's already
    /// gone (a no-op, not an error) -- both `mutate`'s `CloseSession`
    /// branch and a direct `harness_close_session` call can race here.
    pub async fn close_session(&self, session_id: SessionId) -> Result<(), String> {
        let Some(entry) = self.remove_session(&session_id) else {
            return Ok(());
        };
        entry.bridge.fail_all("session closed");
        entry.pump.abort();
        entry.handle.close().await.map_err(|error| error.to_string())
    }
}

/// Not part of `HarnessState` itself (it needs no session table access) --
/// `harness_list_providers`/`harness_list_models`'s shared entry point.
pub async fn list_models(
    harness: &harness_engine::Harness,
    provider: &str,
    refresh: bool,
) -> Result<Vec<harness_engine::ModelDescriptor>, String> {
    let key = harness_engine::ProviderKey(provider.to_string());
    // `_credential` is unread by `Harness::list_models` itself (see its own
    // doc comment) -- a single-user embedded app has no profile selection
    // to make here.
    let credential = harness_engine::CredentialProfileId(String::new());
    harness
        .list_models(&key, &credential, refresh)
        .await
        .map_err(|error| error.to_string())
}

pub fn list_providers(harness: &harness_engine::Harness) -> Result<Vec<harness_engine::ProviderDescriptor>, String> {
    harness.list_providers().map_err(|error| error.to_string())
}

#[cfg(test)]
mod integration_tests {
    //! Exercises `create_session`'s own recipe-conversion path (minus
    //! provider resolution, which rusty-core's own test suite already
    //! covers) together with `mutate`, `host_tool_result`, and the event
    //! pump, end to end: a scripted backend requests a host tool call, the
    //! IDE side (here: the test itself) answers it via `host_tool_result`,
    //! and the session reports `ToolCallCompleted`. This is the "integration
    //! test... asserting HostToolCall -> result round trip" HARNESS_CONTRACT_
    //! PLAN.md's Milestone B2 section calls for.

    use std::sync::{Arc, Mutex};
    use std::time::Duration;

    use async_trait::async_trait;
    use harness_engine::Harness;
    use harness_protocol::backend::{BackendCapabilities, BackendDescriptor, ExecutionEvent, ExecutionResult};
    use harness_protocol::commands::UserInput;
    use harness_protocol::events::AgentEvent;
    use harness_protocol::ids::{BackendId, RequestId, ToolCallId};
    use harness_protocol::rpc::MutationCommand;
    use harness_protocol::tools::ToolCall;
    use harness_protocol::usage::{Cost, ModelUsage};
    use harness_runtime::testing::FakeBackend;
    use harness_runtime::traits::ExecutionBackend;
    use harness_runtime::{IntegrationError, IntegrationFactory};

    use super::super::recipe::build_session_builder;
    use super::*;

    /// Hands back a pre-built `FakeBackend` for any config -- this test's
    /// only integration, registered instead of one of `HarnessState::
    /// harness()`'s seven real ones (which need real provider credentials).
    struct FakeIntegrationFactory {
        backend: Arc<FakeBackend>,
    }

    #[async_trait]
    impl IntegrationFactory for FakeIntegrationFactory {
        fn id(&self) -> &'static str {
            "fake"
        }

        fn descriptor(&self) -> BackendDescriptor {
            BackendDescriptor {
                id: BackendId::new(),
                name: "Fake".to_string(),
                description: "test double".to_string(),
                capabilities: BackendCapabilities::default(),
            }
        }

        async fn create(
            &self,
            _config: serde_json::Value,
        ) -> Result<Arc<dyn ExecutionBackend>, Box<dyn std::error::Error + Send + Sync>> {
            Ok(self.backend.clone() as Arc<dyn ExecutionBackend>)
        }
    }

    /// A backend that requests `tool_name` once the first time it's asked to
    /// execute, then reports `finish_reason: "tool_use"`. Mirrors
    /// `harness-engine/tests/real_tools_e2e.rs`'s own `make_tool_call_backend`.
    fn make_tool_call_backend(tool_name: &str, arguments: serde_json::Value) -> Arc<FakeBackend> {
        let request_id = RequestId::new();
        Arc::new(
            FakeBackend::new()
                .with_events(vec![
                    ExecutionEvent::ToolCallRequested {
                        request_id,
                        call: ToolCall { id: ToolCallId::new(), name: tool_name.to_string(), arguments },
                    },
                    ExecutionEvent::Completed {
                        request_id,
                        result: ExecutionResult {
                            request_id,
                            usage: ModelUsage::default(),
                            cost: Cost::default(),
                            finish_reason: "tool_use".into(),
                        },
                    },
                ])
                .with_result(ExecutionResult {
                    request_id,
                    usage: ModelUsage::default(),
                    cost: Cost::default(),
                    finish_reason: "tool_use".into(),
                }),
        )
    }

    #[tokio::test]
    async fn create_session_mutate_and_host_tool_result_round_trip_a_tool_call() {
        let backend = make_tool_call_backend("ask_user_question", serde_json::json!({"question": "which model?"}));

        let harness = Harness::builder()
            .register_integration(Arc::new(FakeIntegrationFactory { backend }))
            .build()
            .await
            .expect("harness with one fake integration should build");

        let recipe: SessionRecipe = serde_json::from_value(serde_json::json!({
            "workspace": { "root": "/tmp", "binding": "host" },
            "integration": "fake",
            "host_tools": [
                { "name": "ask_user_question", "description": "Ask the user a clarifying question." }
            ]
        }))
        .expect("recipe should deserialize");

        // The same steps `HarnessState::create_session` itself takes, just
        // against this test's own `harness` (with the fake integration)
        // rather than `HarnessState::harness()`'s hardcoded seven real ones.
        let (outbound_tx, outbound_rx) = mpsc::unbounded_channel();
        let bridge = Arc::new(HostBridge::new(outbound_tx.clone()));
        let builder = build_session_builder(&harness, recipe, bridge.clone(), None).await.expect("recipe should convert");
        let handle = builder.start().await.expect("session should start");
        let session_id = handle.session_id();
        let pump = super::super::spawn_event_pump(handle.subscribe(), outbound_tx);

        let state = HarnessState::new();
        state.insert_session(
            session_id,
            SessionEntry {
                handle: Arc::new(handle),
                bridge,
                inbox: Mutex::new(Some(outbound_rx)),
                pump,
            },
        );

        // Drive it exactly the way the Tauri commands would.
        state
            .mutate(session_id, MutationCommand::Prompt(UserInput { text: "hi".into(), attachments: vec![] }))
            .await
            .expect("prompt should be accepted");

        let mut inbox = state.take_inbox(session_id).expect("session should still have an inbox");

        // Wait for the HostToolCall the scripted ToolCallRequested triggers.
        let call_id = loop {
            let event = tokio::time::timeout(Duration::from_secs(2), inbox.recv())
                .await
                .expect("must not hang waiting for the tool call")
                .expect("inbox should not close before the tool call arrives");
            if let BridgeEvent::HostToolCall { call_id, tool, .. } = event {
                assert_eq!(tool, "ask_user_question");
                break call_id;
            }
        };

        state
            .host_tool_result(session_id, &call_id, Ok(serde_json::json!({"answer": "opus"})))
            .expect("session should still be registered");

        // Wait for the session to report the tool call completed.
        let mut saw_completed = false;
        let deadline = tokio::time::Instant::now() + Duration::from_secs(3);
        while tokio::time::Instant::now() < deadline {
            let Ok(Some(event)) = tokio::time::timeout(Duration::from_millis(100), inbox.recv()).await else {
                continue;
            };
            if let BridgeEvent::Event(envelope) = event {
                if matches!(envelope.event, AgentEvent::ToolCallCompleted { .. }) {
                    saw_completed = true;
                    break;
                }
            }
        }
        assert!(saw_completed, "expected a ToolCallCompleted event after answering the host tool call");
    }
}
