import type { McpServerSpec } from "@rusty/harness-sdk";
import type { McpServerConfig } from "../../components/mcp/types";
import type { SessionRecipe } from "./SessionRecipe";
import { mcpServerAccess } from "./skillExecutionPolicy";

/**
 * Tells the model which MCP integrations this session actually has, so a model
 * asked about Jira calls the integration's tools instead of looking for config
 * files. rusty-core names MCP tools `mcp__<server>__<tool>`.
 */
export function mcpIntegrationsSection(
  specs: McpServerSpec[],
  configs: McpServerConfig[],
  policy: NonNullable<SessionRecipe["execution_policy"]>,
): string {
  if (specs.length === 0) return "";

  const label = (name: string) => {
    const config = configs.find((candidate) => candidate.name === name);
    const title = config?.displayName || name;
    return config?.description ? `${title} — ${config.description}` : title;
  };

  const usable: string[] = [];
  const unavailable: string[] = [];
  for (const { name } of specs) {
    const result = mcpServerAccess(policy, name);
    if (result.access === "full") usable.push(`- ${name}: ${label(name)}`);
    else if (result.access === "read_only") {
      usable.push(`- ${name}: ${label(name)} (read-only tools only, because of ${result.reason})`);
    } else unavailable.push(`- ${name} (${label(name)}): ${result.reason}`);
  }

  let section = "";
  if (usable.length > 0) {
    section += `

Connected MCP integrations (their tools are in your tool list, named mcp__<integration>__<tool>, e.g. mcp__atlassian__getJiraIssue):
${usable.join("\n")}
When a request involves one of these services (for example Jira issues or Confluence pages, or GitHub issues and pull requests), call its tools directly instead of searching the workspace for configuration or asking the user to set anything up. If a tool needs an identifier such as a site, cloud, or project ID, first call the integration's tool that lists accessible resources. A read-only integration only exposes tools that look things up; if the user asks you to change something through it, say it needs a skill that can write (such as Build). If none of an integration's tools are in your tool list, it failed to connect or exposes no tools usable here: tell the user to check it with Test Connection in the MCP tab.`;
  }
  if (unavailable.length > 0) {
    section += `

MCP integrations the user connected that are unavailable in this session:
${unavailable.join("\n")}
If the user asks for one of these, explain why and how to enable it (tick the server for the active skill in the Skills tab) instead of guessing.`;
  }
  return section;
}
