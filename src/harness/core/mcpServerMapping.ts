// ============================================================
// mcpServerMapping.ts — McpServerConfig (src/components/mcp/types.ts, the
// app's own richer shape: transport.type stdio/http/sse/websocket, a
// structured `auth` object) -> McpServerSpec (@rusty/harness-sdk's wire
// shape recipe.rs sends to rusty-core: only stdio/http transport kinds,
// raw headers).
//
// `sse` maps onto the SDK's "http" transport kind (same URL-based request
// shape at the spec level). `websocket` and `auth.type === "oauth2"` have
// no target in the SDK's shape -- that server is skipped, with a reason,
// rather than failing the whole recipe (same graceful-degrade philosophy
// as recipe.rs's own `register_mcp_servers`, which drops a server that
// fails to *connect*; this drops one that can't even be *described* yet).
//
// Header values (`auth.value`/`auth.token`) are copied through verbatim,
// `${ENV_VAR}` placeholder intact -- recipe.rs's own `interpolate_env_vars`
// resolves them against the real Rust process's environment. Resolving
// them here instead would hit the same browser-has-no-`process.env` gap
// Phase 2's `directExecution.ts` already documented for `resolveProviderApiKey`.
// ============================================================

import type { AuthConfig, McpServerConfig } from "../../components/mcp/types";
import type { McpServerSpec } from "@rusty/harness-sdk";

export type McpServerMappingResult = { ok: true; spec: McpServerSpec } | { ok: false; reason: string };

function buildAuthHeaders(auth: AuthConfig): Record<string, string> | undefined {
  if (auth.type === "apiKey" && auth.header) {
    return { [auth.header]: auth.value ?? "" };
  }
  if (auth.type === "bearer") {
    return { Authorization: `Bearer ${auth.token ?? ""}` };
  }
  return undefined;
}

export function mapMcpServerConfig(config: McpServerConfig): McpServerMappingResult {
  if (!config.enabled) {
    return { ok: false, reason: `MCP server '${config.name}' is disabled` };
  }
  if (config.transport.type === "websocket") {
    return { ok: false, reason: `MCP server '${config.name}' uses websocket transport, not supported on a core-routed session yet` };
  }
  if (config.auth.type === "oauth2") {
    return { ok: false, reason: `MCP server '${config.name}' uses OAuth2 auth, not supported on a core-routed session yet` };
  }

  const request_timeout_secs = config.timeout > 0 ? Math.round(config.timeout / 1000) : undefined;

  if (config.transport.type === "stdio") {
    if (!config.transport.command) {
      return { ok: false, reason: `MCP server '${config.name}' has a stdio transport but no command configured` };
    }
    return {
      ok: true,
      spec: {
        name: config.name,
        transport: {
          kind: "stdio",
          command: config.transport.command,
          args: config.transport.args,
          env: config.transport.env,
        },
        request_timeout_secs,
      },
    };
  }

  // "http" and "sse" both map onto the SDK's "http" transport kind.
  if (!config.transport.url) {
    return { ok: false, reason: `MCP server '${config.name}' has a ${config.transport.type} transport but no url configured` };
  }
  return {
    ok: true,
    spec: {
      name: config.name,
      transport: { kind: "http", url: config.transport.url, headers: buildAuthHeaders(config.auth) },
      request_timeout_secs,
    },
  };
}

/** Maps a whole list, splitting into the specs recipe.rs can use and the
 * servers that had to be skipped (each with a human-readable reason a
 * caller can log) -- the per-list convenience every definition (global_
 * explore/execute_node/agent_chat) actually wants, so they don't each
 * reimplement the same reduce. */
export function mapMcpServerConfigs(configs: McpServerConfig[]): {
  specs: McpServerSpec[];
  skipped: { name: string; reason: string }[];
} {
  const specs: McpServerSpec[] = [];
  const skipped: { name: string; reason: string }[] = [];
  for (const config of configs) {
    const result = mapMcpServerConfig(config);
    if (result.ok) specs.push(result.spec);
    else skipped.push({ name: config.name, reason: result.reason });
  }
  return { specs, skipped };
}
