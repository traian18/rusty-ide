import { SKILL_TOOLS } from "../../config/skillTools";
import type { SessionRecipe } from "./SessionRecipe";

type ExecutionPolicy = NonNullable<SessionRecipe["execution_policy"]>;

/**
 * Serialize grants; rusty-core owns their interpretation and enforcement.
 *
 * Every skill, built-in or custom, gets exactly the MCP servers ticked for it
 * in the Skills tab. A chat with no skill gets `connectedMcpServers`: every
 * server the user connected and enabled in the MCP tab.
 */
export function skillExecutionPolicy(
  skill: unknown,
  mode: ExecutionPolicy["mode"],
  connectedMcpServers: string[] = [],
): ExecutionPolicy {
  if (skill == null) {
    return { mode, enabled_tools: SKILL_TOOLS.map((tool) => tool.id), allowed_mcp_servers: [...new Set(connectedMcpServers)] };
  }
  if (typeof skill !== "object") throw new Error("Invalid skill permissions");
  const value = skill as { enabledTools?: unknown; mcpServers?: unknown };
  if (!Array.isArray(value.enabledTools) || !value.enabledTools.every((tool) => typeof tool === "string")) {
    throw new Error("Skill enabledTools must be an explicit list");
  }
  if (value.mcpServers !== undefined && (!Array.isArray(value.mcpServers) || !value.mcpServers.every((server) => typeof server === "string"))) {
    throw new Error("Skill mcpServers must be a list of server names");
  }
  return {
    mode,
    enabled_tools: [...new Set(value.enabledTools)],
    allowed_mcp_servers: [...new Set((value.mcpServers ?? []) as string[])],
  };
}

export type McpServerAccess =
  | { access: "full" }
  | { access: "read_only"; reason: string }
  | { access: "denied"; reason: string };

/**
 * What rusty-core will let a session under `policy` use from `server`.
 * Mirrors `harness_core::execution_policy::mcp_server_access`; "read_only"
 * means only the tools the server itself marks `readOnlyHint: true`.
 */
export function mcpServerAccess(policy: ExecutionPolicy, server: string): McpServerAccess {
  if (!policy.allowed_mcp_servers.includes(server)) {
    return { access: "denied", reason: "not ticked for the active skill in the Skills tab" };
  }
  if (!policy.enabled_tools.includes("web_search")) {
    return { access: "denied", reason: "the active skill doesn't grant web_search (network access)" };
  }
  if (policy.mode !== "execute") return { access: "read_only", reason: `${policy.mode} mode` };
  if (!policy.enabled_tools.includes("write_file")) {
    return { access: "read_only", reason: "the active skill doesn't grant write_file" };
  }
  return { access: "full" };
}
