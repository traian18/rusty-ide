//! `SessionRecipe`: the wire shape `harness_create_session` accepts, and
//! its conversion into a real rusty-core `SessionBuilder`.
//!
//! Snake_case, and deliberately a superset of `harness_protocol::rpc::
//! RpcRequestBody::CreateSession` (same `mcp_servers`/`skills` spec types,
//! reused directly rather than mirrored a second time) plus the fields an
//! embedded desktop app needs that a wire RPC client doesn't:
//! `workspace.binding` (host-routed vs. real disk) and `host_tools`
//! (IDE-implemented tools, distinct from rusty-core's own built-in ones).

mod compaction;

use std::path::PathBuf;
use std::sync::Arc;

use async_trait::async_trait;
use harness_engine::{
    Harness, HarnessError, McpServerConfig, McpTransportConfig, SessionBuilder, SkillsConfig,
};
use harness_protocol::mcp::{McpServerSpec, McpTransportSpec};
use harness_protocol::skills::SkillsSpec;
use harness_tools::{
    CancellationToken, SimpleToolRegistry, ToolDescriptor, ToolError, ToolExecutor, ToolId,
    ToolInput, ToolResult,
};
use serde::Deserialize;

use super::host_bridge::HostBridge;
use super::host_execution_backend::HostExecutionBackend;
use super::host_tools::HostToolExecutor;
use super::host_workspace::HostWorkspace;

use compaction::compaction_provider;
pub use compaction::{CompactionMode, ContextCompactionRecipe, JevCompactionRecipe};

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

    async fn execute(
        &self,
        _input: ToolInput,
        _cancel: CancellationToken,
    ) -> Result<ToolResult, ToolError> {
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
    /// Behavior profile for the root agent (`.rusty/profiles/`). `None` uses
    /// the workspace default from `.rusty/profiles/config.json`, else the
    /// built-in neutral profile.
    #[serde(default)]
    pub behavior_profile: Option<harness_engine::ProfileRef>,
    /// A profile document the IDE supplies for this kind of session (the
    /// single agent's completion gate). Used only when `behavior_profile` is
    /// unset and the workspace names no default of its own.
    #[serde(default)]
    pub default_profile: Option<serde_json::Value>,
    /// Repository documentation as context: the work in progress, from the IDE. Absent or disabled
    /// means no repository context.
    #[serde(default)]
    pub repository_context: Option<super::repository_context::RepositoryContextSpec>,
    /// The workspace's repositories, attached by the command that creates the session.
    #[serde(skip)]
    pub repository_state: Option<crate::repository::RepositoryState>,
    /// An orchestration definition (a `.rusty/workflows/*.json` document)
    /// to run on this session with `harness_start_workflow` instead of
    /// prompting it. Its agent steps run in isolated sessions that share
    /// this session's backend, workspace and tools -- so their model turns
    /// and host tool calls arrive on this session's bridge. Also lets draft
    /// profiles run, since the Behaviors canvas creates them as drafts.
    #[serde(default)]
    pub workflow: Option<serde_json::Value>,
    /// How long conversations are compacted. Absent means `standard`.
    #[serde(default)]
    pub context_compaction: Option<ContextCompactionRecipe>,
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
    let summary_model = recipe
        .execution_params
        .as_ref()
        .and_then(|params| params.model.clone());
    let mut builder = base_builder(
        harness,
        recipe.integration,
        recipe.integration_config,
        &bridge,
    )?;
    if let Some(params) = recipe.execution_params {
        builder = builder.execution_params(params);
    }
    builder = with_context_providers(
        builder,
        super::repository_context::providers(
            recipe.system_prompt,
            recipe.repository_context.as_ref(),
            recipe.repository_state.as_ref(),
            &recipe.workspace.root.to_string_lossy(),
        ),
    );
    let compaction = recipe.context_compaction.unwrap_or_default();
    builder = builder.context_provider_with_backend(move |backend| {
        compaction_provider(&compaction, backend, summary_model)
    });
    if let Some(spec) = recipe.skills {
        builder = builder.skills(skills_config_from_spec(spec, &recipe.workspace.root));
    }

    builder = builder.workspace(session_workspace(&recipe.workspace, &bridge));
    // Behavior profiles live with the project. Opening a folder in the IDE is
    // the trust decision for its profiles; shell-command evaluators stay off.
    builder = builder.workspace_profiles(recipe.workspace.root.clone());
    builder = with_profile(
        builder,
        &recipe.workspace.root,
        recipe.behavior_profile,
        recipe.default_profile,
    );

    let registry = host_tool_registry(recipe.host_tools, &bridge);
    // Discovery belongs to the harness so disallowed servers are never started.
    for spec in recipe.mcp_servers {
        builder = builder.optional_mcp_server(mcp_config_from_spec(spec));
    }
    if let Some(policy) = recipe.execution_policy {
        builder = builder.execution_policy(policy);
    }
    register_optional_builtin_tools(
        &registry,
        recipe.enable_web_fetch,
        recipe.enable_agent_spawn,
    );

    Ok(builder.tools(Arc::new(registry)))
}

/// A session on the recipe's integration, or on the IDE itself for `"host"`.
fn base_builder(
    harness: &Harness,
    integration: String,
    integration_config: serde_json::Value,
    bridge: &Arc<HostBridge>,
) -> Result<SessionBuilder, HarnessError> {
    if integration == HOST_EXECUTION_INTEGRATION {
        // `.backend()` is infallible (unlike `.integration()`, there is no
        // registry lookup or provider-config deserialization that could
        // fail here) and mutually exclusive with `.integration()` --
        // rusty-core's own pre-existing escape hatch
        // (`SessionBuilder::backend`), unmodified by this.
        return Ok(harness
            .session()
            .backend(Arc::new(HostExecutionBackend::new(bridge.clone()))));
    }
    harness
        .session()
        .integration(integration, integration_config)
}

/// One context provider is used as is; several are chained in order.
fn with_context_providers(
    builder: SessionBuilder,
    mut providers: Vec<Arc<dyn harness_context::ContextProvider>>,
) -> SessionBuilder {
    match providers.len() {
        0 => builder,
        1 => builder.context_provider(providers.remove(0)),
        _ => builder.context_provider(Arc::new(harness_context::ChainedContextProvider::new(
            providers,
        ))),
    }
}

/// The IDE's view of the workspace (`binding: "host"`) or the real disk.
fn session_workspace(
    workspace: &WorkspaceRecipe,
    bridge: &Arc<HostBridge>,
) -> Arc<dyn harness_workspace::Workspace> {
    match workspace.binding {
        WorkspaceBinding::Host => {
            Arc::new(HostWorkspace::new(workspace.root.clone(), bridge.clone()))
        }
        WorkspaceBinding::Disk => {
            Arc::new(harness_workspace::FsWorkspace::new(workspace.root.clone()))
        }
    }
}

/// The recipe's behavior profile, else the IDE's default one unless the
/// workspace names its own default.
fn with_profile(
    builder: SessionBuilder,
    root: &std::path::Path,
    behavior_profile: Option<harness_engine::ProfileRef>,
    default_profile: Option<serde_json::Value>,
) -> SessionBuilder {
    if let Some(profile) = behavior_profile {
        return builder.profile(profile);
    }
    match default_profile {
        Some(document) if !workspace_names_default_profile(root) => {
            with_default_profile(builder, document)
        }
        _ => builder,
    }
}

fn with_default_profile(builder: SessionBuilder, document: serde_json::Value) -> SessionBuilder {
    let profiles = harness_engine::ProfilesConfig::default();
    match profiles.register_json(document) {
        Ok(reference) => builder.profiles(profiles).profile(reference),
        // A bad built-in document must not stop the chat: run without it.
        Err(error) => {
            eprintln!("[harness] ignoring the session's default profile: {error}");
            builder
        }
    }
}

/// `.tools()`, not `.toolset()`: registering only what this recipe asks
/// for and letting `start()` derive the model-facing `AgentToolset` from
/// the registry (`SessionBuilder::start`'s own "callers that provide a
/// registry directly" fallback -- every registered descriptor's `name`
/// becomes what the model sees, at `PermissionMode::Allow`). No built-in
/// tools land in the registry this way (see `HostToolSpec`'s doc comment
/// on U1) except the two Phase 6 opt-ins in `register_optional_builtin_tools`,
/// both of which construct their own executor directly rather than going
/// through the U1-blocked `build_executor_for` -- see this file's own doc
/// comments on why neither actually needs it.
fn host_tool_registry(
    host_tools: Vec<HostToolSpec>,
    bridge: &Arc<HostBridge>,
) -> SimpleToolRegistry {
    let registry = SimpleToolRegistry::new();
    for spec in host_tools {
        let descriptor = ToolDescriptor {
            id: ToolId::new(spec.name.clone()),
            name: spec.name,
            description: spec.description,
            input_schema: spec.input_schema,
        };
        register_tool(
            &registry,
            Arc::new(HostToolExecutor::new(descriptor, bridge.clone())),
        );
    }
    registry
}

/// Registers a tool, keeping the first one registered under a name. A
/// duplicate within one recipe is a recipe bug, not a reason to fail the
/// session (`SessionBuilder::toolset` ignores the same failure), so it is
/// logged and skipped.
fn register_tool(registry: &SimpleToolRegistry, tool: Arc<dyn ToolExecutor>) {
    if let Err(error) = registry.register_tool(tool) {
        eprintln!("[harness] skipping a tool registration: {error}");
    }
}

/// Whether `<root>/.rusty/profiles/config.json` exists: that file is how a
/// workspace names its default profile, which then wins over the IDE's.
fn workspace_names_default_profile(root: &std::path::Path) -> bool {
    root.join(".rusty/profiles/config.json").is_file()
}

/// Registers optional built-ins. The harness applies the execution policy
/// to these descriptors before advertising or executing them.
fn register_optional_builtin_tools(
    registry: &SimpleToolRegistry,
    enable_web_fetch: bool,
    enable_agent_spawn: bool,
) {
    if enable_web_fetch {
        register_tool(registry, Arc::new(harness_tool_web::FetchTool::new()));
    }
    if enable_agent_spawn {
        register_tool(registry, Arc::new(AgentSpawnDescriptorOnly::new()));
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
        McpTransportSpec::Stdio {
            command,
            args,
            mut env,
            cwd,
        } => {
            // Setting PATH on the child also changes where `command` itself is
            // looked up, so this is what makes `uvx`/`npx`/`docker` spawnable
            // from a Finder-launched app.
            if let Some(path) = super::user_path::user_path() {
                env.entry("PATH".to_string())
                    .or_insert_with(|| path.to_string());
            }
            McpTransportConfig::Stdio {
                command,
                args,
                env,
                cwd,
            }
        }
        McpTransportSpec::Http { url, headers } => McpTransportConfig::Http {
            url,
            headers: headers
                .into_iter()
                .map(|(k, v)| (k, interpolate_env_vars(&v)))
                .collect(),
        },
    };
    McpServerConfig {
        name: spec.name,
        transport,
        request_timeout: spec
            .request_timeout_secs
            .map(std::time::Duration::from_secs),
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
        workspace_root: spec
            .include_workspace_dir
            .then(|| workspace_root.to_path_buf()),
        include_user_dir: spec.include_user_dir,
        extra_roots: spec.roots,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_single_agent_profile_is_a_valid_profile_with_a_guidelines_and_todo_gate() {
        let document: serde_json::Value = serde_json::from_str(include_str!(
            "../../../src/harness/core/definitions/singleAgentProfile.json"
        ))
        .unwrap();
        let reference = harness_engine::ProfilesConfig::default()
            .register_json(document.clone())
            .expect("rusty-core accepts the single-agent profile");
        assert_eq!(reference.id.as_str(), "ide.single-agent");
        let checks = document["completion_gate"]["checks"].as_array().unwrap();
        let tools: Vec<&str> = checks
            .iter()
            .map(|c| c["evaluator"]["tool"].as_str().unwrap())
            .collect();
        assert_eq!(tools, ["code_guidelines", "update_todos"]);
        assert_eq!(checks[0]["evaluator"]["args"]["gate"], true);
        for check in checks {
            // Neither may fail a run because it could not run.
            assert_eq!(check["error_policy"], "pass");
            assert_eq!(check["waive_when_exhausted"], true);
        }
    }

    #[test]
    fn default_profile_is_optional_and_parses_a_document() {
        let base = serde_json::json!({ "workspace": { "root": "/tmp" }, "integration": "host" });
        let recipe: SessionRecipe = serde_json::from_value(base.clone()).unwrap();
        assert!(recipe.default_profile.is_none());
        let mut with = base;
        with["default_profile"] = serde_json::json!({ "id": "x" });
        let recipe: SessionRecipe = serde_json::from_value(with).unwrap();
        assert_eq!(
            recipe.default_profile,
            Some(serde_json::json!({ "id": "x" }))
        );
    }

    #[test]
    fn a_workspace_default_profile_is_found_by_its_config_file() {
        let root = tempfile::tempdir().unwrap();
        assert!(!workspace_names_default_profile(root.path()));
        std::fs::create_dir_all(root.path().join(".rusty/profiles")).unwrap();
        std::fs::write(root.path().join(".rusty/profiles/config.json"), "{}").unwrap();
        assert!(workspace_names_default_profile(root.path()));
    }

    #[test]
    fn context_compaction_defaults_to_standard_and_parses_smart() {
        let base = serde_json::json!({ "workspace": { "root": "/tmp" }, "integration": "host" });
        let recipe: SessionRecipe = serde_json::from_value(base).unwrap();
        assert!(recipe.context_compaction.is_none());
        assert_eq!(
            ContextCompactionRecipe::default().mode,
            CompactionMode::Standard
        );

        let smart: SessionRecipe = serde_json::from_value(serde_json::json!({
            "workspace": { "root": "/tmp" }, "integration": "host",
            "context_compaction": {
                "mode": "smart", "context_window": 200000,
                "jev": { "api_key": "k", "model_id": "jev-1", "confidence": 0.7 }
            }
        }))
        .unwrap();
        let config = smart.context_compaction.unwrap();
        assert_eq!(config.mode, CompactionMode::Smart);
        assert_eq!(config.context_window, Some(200_000));
        assert_eq!(config.jev.unwrap().model_id, "jev-1");
    }

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
        assert_eq!(
            descriptor.name,
            harness_runtime::spawn_tool::AGENT_SPAWN_TOOL_NAME
        );
        assert!(
            descriptor.input_schema.get("properties").is_some(),
            "should carry a real input schema, not a placeholder"
        );
    }

    #[test]
    fn register_optional_builtin_tools_registers_both_when_both_flags_are_true() {
        let registry = SimpleToolRegistry::new();
        register_optional_builtin_tools(&registry, true, true);
        assert!(registry.contains("web_fetch"));
        assert!(registry.contains(harness_runtime::spawn_tool::AGENT_SPAWN_TOOL_NAME));
    }

    #[tokio::test]
    async fn agent_spawn_descriptor_only_executor_returns_an_internal_error_rather_than_panicking()
    {
        // Exercises the "should never actually run" execute() body directly
        // -- proves it fails loudly (an infrastructure error) instead of
        // panicking if rusty-core's own by-name interception in
        // agent_runner.rs is ever bypassed or removed upstream.
        let executor = AgentSpawnDescriptorOnly::new();
        let result = executor
            .execute(
                ToolInput {
                    arguments: serde_json::json!({}),
                },
                CancellationToken::new(),
            )
            .await;
        assert!(matches!(result, Err(ToolError::Internal)));
    }

    #[test]
    fn interpolate_env_vars_substitutes_a_set_variable() {
        // SAFETY: test-only, single-threaded within this test's own scope.
        unsafe { std::env::set_var("RUSTY_TEST_MCP_INTERP_VAR", "shh-secret") };
        assert_eq!(
            interpolate_env_vars("Bearer ${RUSTY_TEST_MCP_INTERP_VAR}"),
            "Bearer shh-secret"
        );
        unsafe { std::env::remove_var("RUSTY_TEST_MCP_INTERP_VAR") };
    }

    #[test]
    fn interpolate_env_vars_leaves_plain_text_untouched() {
        assert_eq!(
            interpolate_env_vars("no placeholders here"),
            "no placeholders here"
        );
    }

    #[test]
    fn interpolate_env_vars_substitutes_an_unset_variable_with_empty_string() {
        unsafe { std::env::remove_var("RUSTY_TEST_MCP_INTERP_VAR_UNSET") };
        assert_eq!(
            interpolate_env_vars("x${RUSTY_TEST_MCP_INTERP_VAR_UNSET}y"),
            "xy"
        );
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
