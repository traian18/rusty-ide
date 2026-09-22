// ============================================================
// definitions/global_explore.ts — global_explore on rusty-core
// (HARNESS_CONTRACT_PLAN.md Milestone C): the first capability to register
// real model-facing tools. Unlike generate_skill/generate_task_nodes (no
// tools, one prompt, one result), this drives a real multi-round
// tool-calling loop -- but that loop is entirely rusty-core's own
// agent_runner.rs turn loop; this definition only supplies the recipe
// (host_tools + system prompt) and the IDE-side tool implementations
// (exploreTools.ts). No orchestration of rounds happens here.
//
// The system prompt, PLAN_ONLY_INSTRUCTIONS wrapper, and the "--- SUMMARY
// ---" extraction convention are copied verbatim from
// agent-sidecar/src/capabilities/globalExplore.ts so a core run answers
// the same way the sidecar's own global_explore does -- only the tool
// implementations and the transport change (exploreTools.ts's own header
// comment explains why those can't be a literal port).
//
// Scope deliberately narrower than the sidecar version, documented rather
// than silent:
//  - No LLM-error simulation fallback (the sidecar's own "couldn't reach
//    the model, fabricate a response from a raw file listing" path) --
//    a core run's own Failed event already surfaces a real error to the
//    UI, which is a more honest outcome than a fabricated response
//    presented as the model's own answer.
//
// MCP servers (Phase 6) are wired via mcpServerMapping.ts -- `recipe()`
// maps `input.mcpServers` into `McpServerSpec`s and lets recipe.rs's own
// `register_mcp_servers` connect them (a server that fails to map or
// connect is silently dropped, matching the sidecar's own per-server
// graceful degrade -- not a `supports()` bail-out any more). `web.fetch`
// (Phase 6) is a rusty-core built-in, registered unconditionally via
// `enable_web_fetch`.
// ============================================================

import type { McpServerConfig } from "../../../components/mcp/types";
import type { CustomProvider } from "../../../store/types";
import type { CapabilityResult, GlobalExploreInput } from "../../contract";
import type { RunHost } from "../../contract";
import type { CoreCapabilityDefinition, HostToolHandler } from "../CoreHarness";
import { mapMcpServerConfigs } from "../mcpServerMapping";
import { CORE_MAX_TOKENS, mapProviderToIntegration } from "../providerMapping";
import type { SessionRecipe } from "../SessionRecipe";
import type { Transcript } from "../transcript";
import { EXPLORE_TOOLS, listFilesTool, openDocumentTool, readTool, searchCodebaseTool } from "./exploreTools";
import { flattenHistory } from "./promptHistory";

function asMcpServerConfigs(value: unknown): McpServerConfig[] {
  return Array.isArray(value)
    ? value.filter((v): v is McpServerConfig => !!v && typeof v === "object" && typeof (v as McpServerConfig).name === "string")
    : [];
}

const PLAN_ONLY_INSTRUCTIONS = `<model Instructions>
You are a PLANNING AND ANALYSIS assistant. You MUST follow these rules strictly:
1. NEVER write, generate, or suggest any code, code snippets, file paths, or implementation details
2. NEVER provide import statements, function signatures, or class definitions
3. ONLY provide: structured plans, step-by-step descriptions, architecture analysis, dependency mapping, risk assessment
4. ALWAYS structure your response with clear section headers and bullet points
5. Focus on WHAT needs to be done and WHY, never HOW to implement it in code
6. Your entire response must be descriptive planning content only - absolutely no code
<model Instructions>
<user prompt>
`;

function systemPrompt(workspaceRoot: string): string {
  return `You are a codebase exploration assistant inside a spatial development canvas called Rusty.
Your job is to analyze the workspace and provide architectural summaries, patterns, and guidelines.

Workspace root: ${workspaceRoot || "unknown"}

You have access to tools:
- 'read': Read any file in the workspace (input: {{"path": "file/path"}}).
- 'open_document': Open, read, and extract readable content from documents including Excel spreadsheets (.xlsx, .xls), PDF documents (.pdf), Word (.docx), or CSV files (input: {{"path": "document/path", "sheet"?: "Sheet1", "page"?: 1}}).
- 'list_files': List all files in the workspace recursively (no input needed).
- 'search_codebase': Search for text patterns across the codebase (input: {{"pattern": "search text"}}).
- 'web_fetch': Fetch the contents of a URL when the user references external documentation or a webpage.

If any MCP integration tools appear in your tool list, call them for external data your other tools can't reach.

IMPORTANT: Always use tools to explore the codebase before answering. Start by listing files, then read relevant ones.

After exploring, provide:
1. A clear architectural summary of the codebase structure.
2. Key patterns and conventions used.
3. Guidelines for making changes that align with the existing codebase.

IMPORTANT: End your response with a section marked "--- SUMMARY ---" that contains a concise bullet-point list of architectural guidelines. This summary will be injected into all task execution prompts.
`;
}

function extractSummary(response: string): string | undefined {
  const match = response.match(/---\s*SUMMARY\s*---([\s\S]*?)$/i);
  return match ? match[1].trim() : undefined;
}

export const globalExploreDefinition: CoreCapabilityDefinition<"global_explore"> = {
  capability: "global_explore",

  supports: (input) => mapProviderToIntegration(input.customProvider as CustomProvider, input.model).supported,

  recipe: (input: GlobalExploreInput): SessionRecipe => {
    const mapped = mapProviderToIntegration(input.customProvider as CustomProvider, input.model);
    if (!mapped.supported) {
      throw new Error(`CoreHarness: global_explore cannot run on core -- ${mapped.reason}`);
    }
    const { specs: mcpServers, skipped } = mapMcpServerConfigs(asMcpServerConfigs(input.mcpServers));
    for (const { reason } of skipped) console.warn(`[global_explore] ${reason}`);
    return {
      workspace: { root: input.workspaceRoot, binding: "host" },
      integration: mapped.integration,
      integration_config: mapped.integration_config,
      execution_params: { model: mapped.model ?? input.model, max_tokens: CORE_MAX_TOKENS, reasoning_effort: mapped.reasoningEffort },
      system_prompt: systemPrompt(input.workspaceRoot),
      host_tools: EXPLORE_TOOLS,
      mcp_servers: mcpServers,
      enable_web_fetch: true,
    };
  },

  promptText: (input) => {
    const history = flattenHistory(input.chatHistory);
    const prompt = input.planOnly ? `${PLAN_ONLY_INSTRUCTIONS}${input.prompt}\n<user prompt>` : input.prompt;
    return `${history}${prompt}`;
  },

  hostTools: (input, host: RunHost): Record<string, HostToolHandler> => ({
    read: readTool(input.workspaceRoot, host),
    open_document: openDocumentTool(input.workspaceRoot),
    list_files: listFilesTool(input.workspaceRoot),
    search_codebase: searchCodebaseTool(input.workspaceRoot),
  }),

  toResult: (transcript: Transcript, _input): CapabilityResult<"global_explore"> => {
    const response = transcript.lastMessageText() || "Exploration completed.";
    return { response, summary: extractSummary(response) };
  },

  usageContext: (input) => ({ workspaceRoot: input.workspaceRoot, model: input.model }),
};
