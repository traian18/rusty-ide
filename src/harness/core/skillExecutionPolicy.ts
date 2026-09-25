import { SKILL_TOOLS } from "../../config/skillTools";
import type { SessionRecipe } from "./SessionRecipe";

/** Serialize grants; rusty-core owns their interpretation and enforcement. */
export function skillExecutionPolicy(
  skill: unknown,
  mode: NonNullable<SessionRecipe["execution_policy"]>["mode"],
): NonNullable<SessionRecipe["execution_policy"]> {
  if (skill == null) {
    return { mode, enabled_tools: SKILL_TOOLS.map((tool) => tool.id), allowed_mcp_servers: [] };
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
