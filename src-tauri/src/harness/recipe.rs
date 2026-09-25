//! `SessionRecipe`: the wire shape `harness_create_session` accepts, and
//! its conversion into a real rusty-core `SessionBuilder`.
//!
//! Snake_case, and deliberately a superset of `harness_protocol::rpc::
//! RpcRequestBody::CreateSession` (same `mcp_servers`/`skills` spec types,
//! reused directly rather than mirrored a second time) plus the fields an
//! embedded desktop app needs that a wire RPC client doesn't:
//! `workspace.binding` (host-routed vs. real disk) and `host_tools`
//! (IDE-implemented tools, distinct from rusty-core's own built-in ones).

use std::path::PathBuf;
use std::sync::Arc;

use async_trait::async_trait;
use harness_engine::{Harness, HarnessError, McpServerConfig, McpTransportConfig, SessionBuilder, SkillsConfig};
use harness_protocol::mcp::{McpServerSpec, McpTransportSpec};
use harness_protocol::skills::SkillsSpec;
use harness_tools::{CancellationToken, SimpleToolRegistry, ToolDescriptor, ToolError, ToolExecutor, ToolId, ToolInput, ToolResult};
use serde::Deserialize;

use super::host_bridge::HostBridge;
use super::host_execution_backend::HostExecutionBackend;
use super::host_tools::HostToolExecutor;
use super::host_workspace::HostWorkspace;

/// Advertises `agent_spawn` to the model without registering a reachable
/// executor for it -- rusty-core's own `agent_runner.rs` intercepts calls
/// to this exact tool name *before* any tool-registry lookup happens (its
/// interception needs `&mut self` access to the running session that a
/// normal detached tool-execution task can't have), so the registry only
/// ever needs to carry the tool's `ToolDescriptor` for the model to see it
/// as available. `execute()` is provably unreachable given that
/// interception -- if it ever actually runs, that assumption has stopped
/// holding upstream; this returns a clearly-labeled infrastructure error
/// (not a panic) so a regression surfaces as "spawn behaved oddly" rather
/// than crashing the session.
struct AgentSpawnDescriptorOnly {
    descriptor: ToolDescriptor,
}

impl AgentSpawnDescriptorOnly {
    fn new() -> Self {
        // `agent_spawn_tool_descriptor` takes/returns `harness_protocol`'s
        // own UUID-based `ToolId`/`ToolDescriptor` (a different, unrelated
        // pair of types from `harness_tools::{ToolId,ToolDescriptor}`,
        // despite the identical names -- confirmed by the compiler, not
        // assumed). The random UUID it wants doesn't matter here (the
        // by-name interception in `agent_runner.rs` keys off `name`, always
        // `AGENT_SPAWN_TOOL_NAME`, never `id`) -- only `name`/`description`/
        // `input_schema` need to survive the conversion into the
        // `harness_tools` shape `SimpleToolRegistry` actually stores.
        let protocol_descriptor = harness_runtime::spawn_tool::agent_spawn_tool_descriptor(
            harness_protocol::ids::ToolId::new(),
        );
        let descriptor = ToolDescriptor {
            id: ToolId::new(harness_runtime::spawn_tool::AGENT_SPAWN_TOOL_NAME),
            name: protocol_descriptor.name,
            description: protocol_descriptor.description,
            input_schema: protocol_descriptor.input_schema,
        };
        Self { descriptor }
    }
}

#[async_trait]
impl ToolExecutor for AgentSpawnDescriptorOnly {
    fn descriptor(&self) -> ToolDescriptor {
        self.descriptor.clone()
    }

    async fn execute(&self, _input: ToolInput, _cancel: CancellationToken) -> Result<ToolResult, ToolError> {
        eprintln!(
            "[recipe] agent_spawn reached AgentSpawnDescriptorOnly::execute() -- rusty-core's own \
             by-name interception in agent_runner.rs should have handled this call before it ever \
             got here; report this as a bug"
        );
        Err(ToolError::Internal)
    }
}

/// The `SessionRecipe.integration` value that routes a session's model
/// execution to the IDE instead of one of rusty-core's own direct HTTP
/// integrations -- see `HostExecutionBackend`'s own module doc for why.
/// Every core-routed session uses this unconditionally (`providerMapping.ts`
/// never produces anything else for an HTTP-transport provider); the direct
/// `anthropic`/`openai`/`openai-compatible`/`gemini` integrations stay
/// registered in `HarnessState::harness()` but are no longer reachable from
/// any recipe the IDE builds.
const HOST_EXECUTION_INTEGRATION: &str = "host";

#[derive(Debug, Clone, Copy, Default, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum WorkspaceBinding {
    /// `read`/`write` round-trip through the IDE via `HostBridge` --
    /// `HostWorkspace`. The default: every capability migrated so far
    /// (Milestone A) routes file I/O through the host, and a core-backed
    /// run should behave the same way unless a capability specifically
    /// needs real disk (e.g. `test_build`, Milestone C).
    #[default]
    Host,
    /// `read`/`write` hit real disk directly -- `harness_workspace::
    /// FsWorkspace`.
    Disk,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct WorkspaceRecipe {
    pub root: PathBuf,
    #[serde(default)]
    pub binding: WorkspaceBinding,
}

/// One tool the IDE itself implements (e.g. a future `ask_user_question`),
/// registered as a `HostToolExecutor`. Distinct from rusty-core's built-in
/// tools (`fs.read`, `git.status`, ...), which this recipe cannot request
/// yet -- see HARNESS_CONTRACT_PLAN.md's upstream ask U1
/// (`SessionBuilder::build_executor_for` is `pub(crate)`, so an embedder
/// can't build one directly; `.tools()`/`.toolset()` also can't be
/// combined today, so mixing built-in and host tools needs U1 regardless).
#[derive(Debug, Deserialize)]
pub struct HostToolSpec {
    pub name: String,
    #[serde(default)]
    pub description: String,
    #[serde(default = "default_input_schema")]
    pub input_schema: serde_json::Value,
}

fn default_input_schema() -> serde_json::Value {
    serde_json::json!({ "type": "object", "properties": {} })
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct SessionRecipe {
    #[serde(default)]
    pub execution_policy: Option<harness_protocol::tools::ExecutionPolicy>,
    pub workspace: WorkspaceRecipe,
    pub integration: String,
    #[serde(default)]
    pub integration_config: serde_json::Value,
    #[serde(default)]
    pub execution_params: Option<harness_protocol::backend::ExecutionParams>,
    #[serde(default)]
    pub system_prompt: Option<String>,
    #[serde(default)]
    pub host_tools: Vec<HostToolSpec>,
    #[serde(default)]
    pub mcp_servers: Vec<McpServerSpec>,
    #[serde(default)]
    pub skills: Option<SkillsSpec>,
    /// Registers rusty-core's own built-in `web_fetch` tool (`harness-tool-
    /// web`, SSRF-guarded, HTML-to-text) directly into this session's
    /// registry -- unlike `host_tools`, this never round-trips through
    /// `HostBridge`; rusty-core executes it itself.
    #[serde(default)]
    pub enable_web_fetch: bool,
    /// Registers `agent_spawn`'s descriptor (see `AgentSpawnDescriptorOnly`
    /// above) so the model can see and call it; rusty-core's own
    /// `agent_runner.rs` handles the actual spawning.
    #[serde(default)]
    pub enable_agent_spawn: bool,
}

/// Converts `recipe` into a ready-to-`.start()` `SessionBuilder`, wiring
/// `bridge` into whichever pieces need to call back into the IDE
/// (`HostWorkspace` when `binding: "host"`, every `host_tools` entry).
///
/// Inference adapters load credentials themselves. The core rejects backends
/// that execute their own tools.
///
/// MCP discovery and skill permissions are delegated to rusty-core. Optional
/// servers retain the IDE's graceful degradation on connection failures.
pub async fn build_session_builder(
    harness: &Harness,
    recipe: SessionRecipe,
    bridge: Arc<HostBridge>,
) -> Result<SessionBuilder, HarnessError> {
    let mut builder = if recipe.integration == HOST_EXECUTION_INTEGRATION {
        // `.backend()` is infallible (unlike `.integration()`, there is no
        // registry lookup or provider-config deserialization that could
        // fail here) and mutually exclusive with `.integration()` --
        // rusty-core's own pre-existing escape hatch
        // (`SessionBuilder::backend`), unmodified by this.
        harness.session().backend(Arc::new(HostExecutionBackend::new(bridge.clone())))
    } else {
        harness.session().integration(recipe.integration, recipe.integration_config)?
    };

    if let Some(params) = recipe.execution_params {
        builder = builder.execution_params(params);
    }
    if let Some(prompt) = recipe.system_prompt {
        builder = builder.context_provider(Arc::new(harness_context::StaticSystemPromptProvider::new(prompt)));
    }
    if let Some(spec) = recipe.skills {
        builder = builder.skills(skills_config_from_spec(spec, &recipe.workspace.root));
    }

    let workspace: Arc<dyn harness_workspace::Workspace> = match recipe.workspace.binding {
        WorkspaceBinding::Host => Arc::new(HostWorkspace::new(recipe.workspace.root.clone(), bridge.clone())),
        WorkspaceBinding::Disk => Arc::new(harness_workspace::FsWorkspace::new(recipe.workspace.root.clone())),
    };
    builder = builder.workspace(workspace);

    // `.tools()`, not `.toolset()`: registering only what this recipe asks
    // for and letting `start()` derive the model-facing `AgentToolset` from
    // the registry (`SessionBuilder::start`'s own "callers that provide a
    // registry directly" fallback -- every registered descriptor's `name`
    // becomes what the model sees, at `PermissionMode::Allow`). No built-in
    // tools land in the registry this way (see `HostToolSpec`'s doc comment
    // on U1) except the two Phase 6 opt-ins below, both of which construct
    // their own executor directly rather than going through the U1-blocked
    // `build_executor_for` -- see this file's own doc comments on why
    // neither actually needs it.
    let registry = SimpleToolRegistry::new();
    for spec in recipe.host_tools {
        let descriptor = ToolDescriptor {
            id: ToolId::new(spec.name.clone()),
            name: spec.name,
            description: spec.description,
            input_schema: spec.input_schema,
        };
        let executor = Arc::new(HostToolExecutor::new(descriptor, bridge.clone()));
        // Only fails on a duplicate id within this same recipe's own
        // host_tools list -- silently keeping the first registration is
        // consistent with how `SessionBuilder::toolset` itself ignores a
        // `register` failure for the same reason.
        let _ = registry.register_tool(executor);
    }

    // Discovery belongs to the harness so disallowed servers are never started.
    for spec in recipe.mcp_servers {
        builder = builder.optional_mcp_server(mcp_config_from_spec(spec));
    }
    if let Some(policy) = recipe.execution_policy {
        builder = builder.execution_policy(policy);
    }
    register_optional_builtin_tools(&registry, recipe.enable_web_fetch, recipe.enable_agent_spawn);

    builder = builder.tools(Arc::new(registry));

    Ok(builder)
}

/// Registers optional built-ins. The harness applies the execution policy
/// to these descriptors before advertising or executing them.
fn register_optional_builtin_tools(registry: &SimpleToolRegistry, enable_web_fetch: bool, enable_agent_spawn: bool) {
    if enable_web_fetch {
        let _ = registry.register_tool(Arc::new(harness_tool_web::FetchTool::new()));
    }
    if enable_agent_spawn {
        let _ = registry.register_tool(Arc::new(AgentSpawnDescriptorOnly::new()));
    }
}

/// Converts the wire-serializable `McpServerSpec` into the real
/// `McpServerConfig` the engine connects with. Copied from
/// `apps/harnessd/src/handler.rs`'s `mcp_config_from_spec` -- same
/// conversion, a different embedder.
///
/// HTTP header values get `${ENV_VAR}` interpolation (`interpolate_env_vars`)
/// -- the IDE-side mapping (`mcpServerMapping.ts`) sends an auth header's raw
/// value verbatim, `${VAR}` placeholder intact, deliberately: this is a real
/// Rust process with real env access, unlike Phase 2's own browser-side gap
/// where the same interpolation had no environment to resolve against.
pub(crate) fn mcp_config_from_spec(spec: McpServerSpec) -> McpServerConfig {
    let transport = match spec.resolve_transport() {
        McpTransportSpec::Stdio { command, args, mut env, cwd } => {
            // Setting PATH on the child also changes where `command` itself is
            // looked up, so this is what makes `uvx`/`npx`/`docker` spawnable
            // from a Finder-launched app.
            if let Some(path) = super::user_path::user_path() {
                env.entry("PATH".to_string()).or_insert_with(|| path.to_string());
            }
            McpTransportConfig::Stdio { command, args, env, cwd }
        }
        McpTransportSpec::Http { url, headers } => McpTransportConfig::Http {
            url,
            headers: headers.into_iter().map(|(k, v)| (k, interpolate_env_vars(&v))).collect(),
        },
    };
    McpServerConfig {
        name: spec.name,
        transport,
        request_timeout: spec.request_timeout_secs.map(std::time::Duration::from_secs),
    }
}

/// Replaces every `${VAR_NAME}` occurrence in `input` with that environment
/// variable's value (empty string if unset) -- mirrors the sidecar's own
/// `mcpClient.ts::resolveEnv`, minus its Node-only `process.env` dependency.
fn interpolate_env_vars(input: &str) -> String {
    let mut result = String::with_capacity(input.len());
    let mut rest = input;
    while let Some(start) = rest.find("${") {
        let Some(end) = rest[start..].find('}') else {
            result.push_str(rest);
            return result;
        };
        result.push_str(&rest[..start]);
        let var_name = &rest[start + 2..start + end];
        result.push_str(&std::env::var(var_name).unwrap_or_default());
        rest = &rest[start + end + 1..];
    }
    result.push_str(rest);
    result
}

/// Converts the wire-serializable `SkillsSpec` into the engine's real
/// `SkillsConfig`. Copied from `apps/harnessd/src/handler.rs`'s
/// `skills_config_from_spec`, including its reasoning for taking
/// `workspace_root` as a separate argument rather than trusting a second
/// copy on the spec itself.
fn skills_config_from_spec(spec: SkillsSpec, workspace_root: &std::path::Path) -> SkillsConfig {
    SkillsConfig {
        workspace_root: spec.include_workspace_dir.then(|| workspace_root.to_path_buf()),
        include_user_dir: spec.include_user_dir,
        extra_roots: spec.roots,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn skill_policy_deserializes_exact_grants_and_rejects_malformed_permissions() {
        let mut value = serde_json::json!({
            "workspace": { "root": "/tmp" }, "integration": "host",
            "execution_policy": { "mode": "plan", "enabled_tools": ["write_file"], "allowed_mcp_servers": ["docs"] }
        });
        let recipe: SessionRecipe = serde_json::from_value(value.clone()).unwrap();
        let policy = recipe.execution_policy.unwrap();
        assert_eq!(policy.mode, harness_protocol::tools::ExecutionMode::Plan);
        assert_eq!(policy.enabled_tools, vec!["write_file"]);
        assert_eq!(policy.allowed_mcp_servers, vec!["docs"]);
        value["execution_policy"]["enabled_tools"] = serde_json::json!("all");
        assert!(serde_json::from_value::<SessionRecipe>(value).is_err());
    }

    #[test]
    fn register_optional_builtin_tools_registers_nothing_when_both_flags_are_false() {
        let registry = SimpleToolRegistry::new();
        register_optional_builtin_tools(&registry, false, false);
        assert!(registry.descriptors().is_empty());
    }

    #[test]
    fn register_optional_builtin_tools_registers_web_fetch_when_enabled() {
        let registry = SimpleToolRegistry::new();
        register_optional_builtin_tools(&registry, true, false);
        assert!(registry.contains("web_fetch"));
        assert!(!registry.contains(harness_runtime::spawn_tool::AGENT_SPAWN_TOOL_NAME));
    }

    #[test]
    fn register_optional_builtin_tools_registers_agent_spawn_with_the_right_descriptor() {
        let registry = SimpleToolRegistry::new();
        register_optional_builtin_tools(&registry, false, true);
        assert!(!registry.contains("web_fetch"));
        let descriptor = registry
            .descriptors()
            .into_iter()
            .find(|d| d.id.as_str() == harness_runtime::spawn_tool::AGENT_SPAWN_TOOL_NAME)
            .expect("agent_spawn should be registered");
        assert_eq!(descriptor.name, harness_runtime::spawn_tool::AGENT_SPAWN_TOOL_NAME);
        assert!(descriptor.input_schema.get("properties").is_some(), "should carry a real input schema, not a placeholder");
    }

    #[test]
    fn register_optional_builtin_tools_registers_both_when_both_flags_are_true() {
        let registry = SimpleToolRegistry::new();
        register_optional_builtin_tools(&registry, true, true);
        assert!(registry.contains("web_fetch"));
        assert!(registry.contains(harness_runtime::spawn_tool::AGENT_SPAWN_TOOL_NAME));
    }

    #[tokio::test]
    async fn agent_spawn_descriptor_only_executor_returns_an_internal_error_rather_than_panicking() {
        // Exercises the "should never actually run" execute() body directly
        // -- proves it fails loudly (an infrastructure error) instead of
        // panicking if rusty-core's own by-name interception in
        // agent_runner.rs is ever bypassed or removed upstream.
        let executor = AgentSpawnDescriptorOnly::new();
        let result = executor
            .execute(ToolInput { arguments: serde_json::json!({}) }, CancellationToken::new())
            .await;
        assert!(matches!(result, Err(ToolError::Internal)));
    }

    #[test]
    fn interpolate_env_vars_substitutes_a_set_variable() {
        // SAFETY: test-only, single-threaded within this test's own scope.
        unsafe { std::env::set_var("RUSTY_TEST_MCP_INTERP_VAR", "shh-secret") };
        assert_eq!(interpolate_env_vars("Bearer ${RUSTY_TEST_MCP_INTERP_VAR}"), "Bearer shh-secret");
        unsafe { std::env::remove_var("RUSTY_TEST_MCP_INTERP_VAR") };
    }

    #[test]
    fn interpolate_env_vars_leaves_plain_text_untouched() {
        assert_eq!(interpolate_env_vars("no placeholders here"), "no placeholders here");
    }

    #[test]
    fn interpolate_env_vars_substitutes_an_unset_variable_with_empty_string() {
        unsafe { std::env::remove_var("RUSTY_TEST_MCP_INTERP_VAR_UNSET") };
        assert_eq!(interpolate_env_vars("x${RUSTY_TEST_MCP_INTERP_VAR_UNSET}y"), "xy");
    }

    #[test]
    fn interpolate_env_vars_handles_multiple_placeholders() {
        unsafe {
            std::env::set_var("RUSTY_TEST_MCP_INTERP_A", "aaa");
            std::env::set_var("RUSTY_TEST_MCP_INTERP_B", "bbb");
        }
        assert_eq!(
            interpolate_env_vars("${RUSTY_TEST_MCP_INTERP_A}-${RUSTY_TEST_MCP_INTERP_B}"),
            "aaa-bbb"
        );
        unsafe {
            std::env::remove_var("RUSTY_TEST_MCP_INTERP_A");
            std::env::remove_var("RUSTY_TEST_MCP_INTERP_B");
        }
    }

    #[test]
    fn interpolate_env_vars_tolerates_an_unclosed_placeholder() {
        assert_eq!(interpolate_env_vars("Bearer ${OOPS"), "Bearer ${OOPS");
    }
}
