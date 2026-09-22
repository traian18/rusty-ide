// ============================================================
// SessionRecipe.ts — TypeScript mirror of the Rust-side
// `SessionRecipe`/`WorkspaceRecipe`/`WorkspaceBinding`/`HostToolSpec`
// (src-tauri/src/harness/recipe.rs), field-for-field, snake_case: this
// shape is sent verbatim as `harness_create_session`'s `recipe` argument,
// which serde deserializes with `#[serde(rename_all = "snake_case")]`.
//
// `McpServerSpec`/`SkillsSpec` are `import type`-ed from the SDK
// (`@rusty/harness-sdk`) rather than redeclared here -- recipe.rs reuses
// rusty-core's own `harness_protocol::mcp::McpServerSpec` /
// `harness_protocol::skills::SkillsSpec` directly (HARNESS_CONTRACT_PLAN.md
// decision 2), and the SDK's types.ts already mirrors those exactly.
//
// `ExecutionParams`/`ReasoningEffort`/`ResponseFormat` are NOT in the SDK
// yet (upstream ask U4) -- mirrored here by hand from
// `harness_protocol::backend::ExecutionParams`
// (rusty-core/crates/harness-protocol/src/backend.rs). Replace this with an
// `import type` from the SDK once U4 lands; until then keep the two in sync
// by hand.
// ============================================================

import type { McpServerSpec, SkillsSpec } from "@rusty/harness-sdk";

export type WorkspaceBinding = "host" | "disk";

export interface WorkspaceRecipe {
  root: string;
  /** Omitted means "host" on the Rust side (`WorkspaceBinding::default()`). */
  binding?: WorkspaceBinding;
}

/**
 * One tool the IDE itself implements, registered as a `HostToolExecutor`.
 * See recipe.rs's `HostToolSpec` doc comment for why this can't yet carry
 * rusty-core's own built-in tools (upstream ask U1).
 */
export interface HostToolSpec {
  name: string;
  description?: string;
  input_schema?: unknown;
}

export type ReasoningEffort = "low" | "medium" | "high";

export type ResponseFormat =
  | { type: "text" }
  | { type: "json_object" }
  | { type: "json_schema"; name: string; schema: unknown; strict?: boolean };

/**
 * Mirrors `harness_protocol::backend::ExecutionParams`. Every field is
 * optional -- `#[serde(default)]` on the Rust struct means an absent field
 * means "use the provider's own default" (or, for a `ConfigureExecution`
 * mutation, "leave whatever was set before"), not "clear a previous value".
 */
export interface ExecutionParams {
  model?: string;
  max_tokens?: number;
  temperature?: number;
  stop_sequences?: string[];
  reasoning_effort?: ReasoningEffort;
  extended_thinking?: boolean;
  response_format?: ResponseFormat;
  provider_options?: unknown;
}

export interface SessionRecipe {
  workspace: WorkspaceRecipe;
  integration: string;
  integration_config?: unknown;
  execution_params?: ExecutionParams;
  system_prompt?: string;
  host_tools?: HostToolSpec[];
  mcp_servers?: McpServerSpec[];
  skills?: SkillsSpec;
  /** Registers rusty-core's own built-in `web_fetch` tool directly into
   * this session's registry (never a `host_tools`/`HostBridge` round trip --
   * see recipe.rs's own doc comment on `register_optional_builtin_tools`). */
  enable_web_fetch?: boolean;
  /** Registers `agent_spawn`'s descriptor so the model can see and call it;
   * rusty-core's own `agent_runner.rs` handles the actual spawning. */
  enable_agent_spawn?: boolean;
}
