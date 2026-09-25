//! Tauri commands mirroring rusty-core's own RPC surface
//! (`harness-protocol/src/rpc.rs`), registered in `lib.rs`'s
//! `invoke_handler!` list next to the VFS commands. Every command is a
//! thin wrapper around `HarnessState`'s own async methods (`session.rs`),
//! which stay callable -- and unit-testable -- without a Tauri runtime.

use tauri::ipc::Channel;
use tauri::State;

use super::recipe::{mcp_config_from_spec, SessionRecipe};
use super::session::SessionSnapshotWire;
use super::{BridgeEvent, HarnessState};
use harness_tools::ToolExecutor;

#[derive(serde::Serialize)]
pub struct HarnessHello {
    pub protocol_version: u32,
    pub capabilities: Vec<&'static str>,
}

fn parse_session_id(value: &str) -> Result<harness_protocol::ids::SessionId, String> {
    value.parse().map_err(|_| format!("invalid session id: {value}"))
}

#[tauri::command]
pub fn harness_hello() -> HarnessHello {
    HarnessHello {
        protocol_version: harness_protocol::rpc::PROTOCOL_VERSION,
        // Policy-bearing requests refuse an older bridge rather than silently
        // dropping permissions when the frontend and native build differ.
        capabilities: vec!["pause_resume", "execution_policy"],
    }
}

#[tauri::command]
pub async fn harness_create_session(
    state: State<'_, HarnessState>,
    recipe: SessionRecipe,
) -> Result<String, String> {
    // Provider inference and tool authorization belong to the harness.
    let session_id = state.create_session(recipe).await?;
    Ok(session_id.to_string())
}

/// Hands this session's buffered events to `on_event`, one Tauri `Channel`
/// message per `BridgeEvent`. Errors if this session already has a
/// subscriber (`HarnessState::take_inbox`) -- a session's inbox can only
/// be taken once, matching the contract's one-subscriber-per-run
/// expectation.
#[tauri::command]
pub async fn harness_subscribe(
    state: State<'_, HarnessState>,
    session_id: String,
    on_event: Channel<BridgeEvent>,
) -> Result<(), String> {
    let session_id = parse_session_id(&session_id)?;
    let mut inbox = state.take_inbox(session_id)?;
    tokio::spawn(async move {
        while let Some(event) = inbox.recv().await {
            if on_event.send(event).is_err() {
                // The frontend side of the channel is gone (window
                // closed, listener torn down) -- stop forwarding.
                break;
            }
        }
    });
    Ok(())
}

#[tauri::command]
pub async fn harness_mutate(
    state: State<'_, HarnessState>,
    session_id: String,
    command: harness_protocol::rpc::MutationCommand,
) -> Result<(), String> {
    let session_id = parse_session_id(&session_id)?;
    state.mutate(session_id, command).await
}

/// Delivers the IDE's answer for a previously issued `HostToolCall`.
/// `ok: false` treats `output` as the failure message when it's a JSON
/// string, or falls back to a generic message for any other JSON shape.
#[tauri::command]
pub fn harness_host_tool_result(
    state: State<'_, HarnessState>,
    session_id: String,
    call_id: String,
    ok: bool,
    output: serde_json::Value,
) -> Result<(), String> {
    let session_id = parse_session_id(&session_id)?;
    let result = if ok {
        Ok(output)
    } else {
        Err(output
            .as_str()
            .map(str::to_string)
            .unwrap_or_else(|| "host tool call failed".to_string()))
    };
    state.host_tool_result(session_id, &call_id, result)
}

/// Delivers one interim `ExecutionEvent` for a still-open `HostExecuteCall`
/// (`HostExecutionBackend::execute`'s streaming counterpart to
/// `harness_host_tool_result`).
#[tauri::command]
pub fn harness_host_execute_event(
    state: State<'_, HarnessState>,
    session_id: String,
    call_id: String,
    event: harness_protocol::backend::ExecutionEvent,
) -> Result<(), String> {
    let session_id = parse_session_id(&session_id)?;
    state.host_execute_event(session_id, &call_id, event)
}

/// Delivers the terminal result for a `HostExecuteCall`. Mirrors
/// `harness_host_tool_result`'s flattened `ok`/payload shape rather than a
/// tagged union, since JSON's boolean `ok` doesn't line up with serde's
/// string-tagged enum discriminant.
#[tauri::command]
pub fn harness_host_execute_result(
    state: State<'_, HarnessState>,
    session_id: String,
    call_id: String,
    ok: bool,
    result: Option<harness_protocol::backend::ExecutionResult>,
    error: Option<harness_protocol::backend::ExecutionError>,
) -> Result<(), String> {
    let session_id = parse_session_id(&session_id)?;
    let outcome: Result<harness_protocol::backend::ExecutionResult, harness_protocol::backend::ExecutionError> = if ok {
        result.ok_or_else(|| harness_protocol::backend::ExecutionError::BackendError {
            message: "harness_host_execute_result: ok=true but no result given".to_string(),
            code: "HOST_EXECUTE_MISSING_RESULT".to_string(),
        })
    } else {
        Err(error.unwrap_or_else(|| harness_protocol::backend::ExecutionError::BackendError {
            message: "host execute call failed".to_string(),
            code: "HOST_EXECUTE_FAILED".to_string(),
        }))
    };
    state.host_execute_result(session_id, &call_id, outcome)
}

#[tauri::command]
pub fn harness_snapshot(state: State<'_, HarnessState>, session_id: String) -> Result<SessionSnapshotWire, String> {
    let session_id = parse_session_id(&session_id)?;
    state.session_snapshot(session_id)
}

#[tauri::command]
pub async fn harness_close_session(state: State<'_, HarnessState>, session_id: String) -> Result<(), String> {
    let session_id = parse_session_id(&session_id)?;
    state.close_session(session_id).await
}

#[tauri::command]
pub async fn harness_list_providers(
    state: State<'_, HarnessState>,
) -> Result<Vec<harness_engine::ProviderDescriptor>, String> {
    let harness = state.harness().await;
    super::session::list_providers(&harness)
}

#[tauri::command]
pub async fn harness_list_models(
    state: State<'_, HarnessState>,
    provider: String,
    refresh: bool,
) -> Result<Vec<harness_engine::ModelDescriptor>, String> {
    let harness = state.harness().await;
    super::session::list_models(&harness, &provider, refresh).await
}

/// On-demand "is this provider currently authenticated" check -- see
/// `managed_auth.rs`'s own doc comment for why this doesn't go through
/// `Harness::provider_health`.
#[tauri::command]
pub async fn managed_auth_status(
    app: tauri::AppHandle,
    state: State<'_, HarnessState>,
    provider: String,
) -> Result<super::managed_auth::LoginState, String> {
    super::managed_auth::check_status(&app, &state.managed_auth, &provider).await
}

/// Starts a login attempt in the background and returns immediately --
/// the frontend polls `managed_auth_login_status` for progress, matching
/// the existing sidecar-backed Copilot/Codex/Claude Code login cards' own
/// polling UX.
#[tauri::command]
pub async fn managed_auth_start_login(app: tauri::AppHandle, state: State<'_, HarnessState>, provider: String) -> Result<(), String> {
    super::managed_auth::start_login(app, state.managed_auth.clone(), provider)
}

#[tauri::command]
pub fn managed_auth_login_status(state: State<'_, HarnessState>, provider: String) -> super::managed_auth::LoginState {
    state.managed_auth.get(&provider)
}

#[tauri::command]
pub async fn managed_auth_logout(app: tauri::AppHandle, state: State<'_, HarnessState>, provider: String) -> Result<(), String> {
    super::managed_auth::logout(&app, &state.managed_auth, &provider).await
}

#[tauri::command]
pub async fn managed_auth_submit_code(state: State<'_, HarnessState>, provider: String, code: String) -> Result<(), String> {
    state.managed_auth.send_input(&provider, code).await
}

#[tauri::command]
pub fn managed_auth_cancel_login(state: State<'_, HarnessState>, provider: String) -> Result<(), String> {
    state.managed_auth.cancel_login(&provider);
    Ok(())
}

/// Subscription quota for a managed-auth provider, read from its own
/// vendored CLI -- see `managed_quota.rs`. Restores what the removed Node
/// sidecar's `/llm/quota` route used to answer.
#[tauri::command]
pub async fn managed_auth_quota(app: tauri::AppHandle, provider: String) -> Result<super::managed_quota::ManagedQuota, String> {
    super::managed_quota::fetch_quota(&app, &provider).await
}

/// Account-aware model catalog from the managed provider's own runtime.
#[tauri::command]
pub async fn managed_auth_models(
    app: tauri::AppHandle,
    provider: String,
) -> Result<Vec<super::managed_models::ManagedModel>, String> {
    super::managed_models::fetch_models(&app, &provider).await
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpTestResult {
    pub tool_count: usize,
    pub tools: Vec<String>,
}

/// Sidecar-removal Phase 7b: the direct replacement for the sidecar's own
/// `POST /mcp/test` route (`mcpTestService.ts` -- the ONLY thing that ever
/// implemented `HarnessControlPlane.testMcp`). Reuses the exact same
/// `harness_tool_mcp::connect_and_discover` call `recipe.rs`'s own
/// `register_mcp_servers` (Phase 6) already makes at session-build time --
/// connect, list the server's tools, report the real result. `server` is
/// already the SDK's `McpServerSpec` shape (the frontend maps the richer
/// `McpServerConfig` -- transport.type/auth -- into it via
/// `mcpServerMapping.ts` before invoking, same conversion `recipe.rs`
/// itself relies on for a session's own `mcp_servers` list, so an
/// unsupported transport/auth kind is rejected client-side with a clear
/// reason before this command is ever called).
#[tauri::command]
pub async fn mcp_test_connection(server: harness_protocol::mcp::McpServerSpec) -> Result<McpTestResult, String> {
    let config = mcp_config_from_spec(server);
    let executors = harness_tool_mcp::connect_and_discover(&config).await.map_err(|error| error.to_string())?;
    let tools: Vec<String> = executors.iter().map(|executor| executor.descriptor().name).collect();
    Ok(McpTestResult { tool_count: tools.len(), tools })
}

#[cfg(test)]
mod mcp_test_connection_tests {
    use super::*;

    #[tokio::test]
    async fn reports_a_clear_error_instead_of_panicking_for_an_unreachable_server() {
        let spec = harness_protocol::mcp::McpServerSpec {
            name: "broken".to_string(),
            transport: None,
            command: "definitely-not-a-real-command-rusty-test-fixture".to_string(),
            args: Vec::new(),
            env: std::collections::HashMap::new(),
            cwd: None,
            request_timeout_secs: None,
        };
        let result = mcp_test_connection(spec).await;
        assert!(result.is_err(), "an unreachable stdio command should report a clear error, not succeed");
    }
}
