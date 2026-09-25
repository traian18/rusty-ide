// ============================================================
// definitions/execute_node.ts — execute_node on rusty-core (Milestone C):
// a bounded task-node code executor with read/write file tools -- the
// second tool-using capability after global_explore, and the first that
// actually modifies files.
//
// The system prompt (defaultSystemPrompt + skillGuidance), the tool
// name/description set, and the `skill.enabledTools` filtering semantics
// are copied/ported from agent-sidecar/src/capabilities/executeNode.ts.
// "read_file"/"list_files"/"search_codebase" reuse exploreTools.ts's own
// builders (list_files/search_codebase are byte-identical between
// executeNode.ts and globalExplore.ts on the sidecar side -- both call the
// same agent-sidecar/src/services/tools.ts factories); "write_file" is
// exploreTools.ts's new addition for this capability.
//
// Deliberate v1 scope cuts, documented rather than silent (same pattern as
// global_explore's own):
//  - No LSP tools: HARNESS_CONTRACT_PLAN.md already documents this gap
//    ("LSP tools on core sessions wait for LSP-to-Rust ... or ride as
//    host tools that call the sidecar's LSP from TS in the meantime") --
//    supports() returns false whenever lspSettings.enabled is true.
//  - No web_search: unlike MCP/LSP, this isn't something executeNode.ts
//    itself builds as a tool at all -- the sidecar's own Pi runtime
//    splices a compatible web-search tool into every agentic run
//    internally (visible in a live sidecar log line: "Pi web extension is
//    unavailable with this Pi version; using Agent Tab's compatible
//    web-search tool"). There's nothing in this file to port, and no
//    explicit user configuration is being dropped the way an MCP server
//    or an LSP setting would be, so this isn't gated by supports() --
//    a core-routed run simply doesn't offer it, a quality gap rather than
//    a correctness one.
//
// MCP servers (Phase 6) are wired via mcpServerMapping.ts -- `input.
// mcpContext` (built by agentRunCoordinator.ts) carries `{server, ...}[]`,
// not a flat McpServerConfig[]; `asMcpServerConfigsFromContext` unwraps
// `.server` before mapping. `web.fetch` (Phase 6) is a rusty-core
// built-in, registered unconditionally via `enable_web_fetch`.
// ============================================================

import type { McpServerConfig } from "../../../components/mcp/types";
import type { CustomProvider } from "../../../store/types";
import type { CapabilityResult, ExecuteNodeInput } from "../../contract";
import type { RunHost } from "../../contract";
import type { CoreCapabilityDefinition, HostToolHandler } from "../CoreHarness";
import { mapMcpServerConfigs } from "../mcpServerMapping";
import { CORE_MAX_TOKENS, mapProviderToIntegration } from "../providerMapping";
import { skillExecutionPolicy } from "../skillExecutionPolicy";
import type { HostToolSpec, SessionRecipe } from "../SessionRecipe";
import type { Transcript } from "../transcript";
import { LIST_FILES_TOOL, OPEN_DOCUMENT_TOOL, READ_FILE_TOOL, SEARCH_CODEBASE_TOOL, WRITE_FILE_TOOL, listFilesTool, openDocumentTool, readTool, searchCodebaseTool, writeTool } from "./exploreTools";
import { flattenHistory } from "./promptHistory";

function asMcpServerConfigsFromContext(value: unknown): McpServerConfig[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => (entry && typeof entry === "object" ? (entry as { server?: unknown }).server : undefined))
    .filter((server): server is McpServerConfig => !!server && typeof server === "object" && typeof (server as McpServerConfig).name === "string");
}

interface SkillLike {
  enabledTools?: unknown;
  systemPrompt?: unknown;
}

function asSkill(skill: unknown): SkillLike | undefined {
  return skill && typeof skill === "object" ? (skill as SkillLike) : undefined;
}

const TOOL_SPECS: Record<string, HostToolSpec> = {
  read_file: READ_FILE_TOOL,
  write_file: WRITE_FILE_TOOL,
  list_files: LIST_FILES_TOOL,
  search_codebase: SEARCH_CODEBASE_TOOL,
  open_document: OPEN_DOCUMENT_TOOL,
};
const SUPPORTED_TOOL_NAMES = Object.keys(TOOL_SPECS);

const TOOL_DESCRIPTIONS: Record<string, string> = {
  read_file: "- 'read_file': Read a file's current content before editing it.",
  write_file: "- 'write_file': Write or edit a file.",
  list_files: "- 'list_files': Discover files in the workspace.",
  search_codebase: "- 'search_codebase': Find specific code patterns.",
  open_document: "- 'open_document': Open, read, and extract readable content from documents including Excel (.xlsx, .xls), PDF (.pdf), Word (.docx), or CSV files.",
  web_fetch: "- 'web_fetch': Fetch the contents of a URL when the task references external documentation or a webpage.",
};

/** Matches the sidecar's own `skill?.enabledTools || [defaults]` -- an
 * explicitly empty array (unlike undefined/null) is NOT replaced by the
 * default, since `[] || x` evaluates to `[]` in JS, not `x`. Filtered down
 * to the tool names this port actually supports (no web_search/lsp/
 * run_command yet), regardless of whether the request came from a skill
 * or the default list. */
function toolSpecsFor(skill: SkillLike | undefined): HostToolSpec[] {
  const requested = skill?.enabledTools;
  const names = Array.isArray(requested) ? requested : SUPPORTED_TOOL_NAMES;
  return SUPPORTED_TOOL_NAMES.filter((name) => names.includes(name)).map((name) => TOOL_SPECS[name]);
}

function asRecordArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter((v): v is Record<string, unknown> => typeof v === "object" && v !== null) : [];
}

function buildFilesList(inputFiles: unknown): string {
  const files = asRecordArray(inputFiles);
  if (files.length === 0) {
    return "No input files are directly connected to this task node. You can read/write any files in the workspace.";
  }
  const paths = files.map((f) => String(f.path ?? "")).filter(Boolean);
  return `You have direct read/write access to the following connected files:\n${paths.map((p) => `- ${p}`).join("\n")}\nPlease read them first if you need to modify or inspect them.`;
}

function buildUpstreamSection(upstreamTaskContext: unknown): string {
  const tasks = asRecordArray(upstreamTaskContext);
  if (tasks.length === 0) return "";
  return tasks
    .map((t) => {
      const files = asRecordArray(t.files);
      const fileBlocks = files.map((f) => `--- File: ${String(f.path ?? "")} ---\n${String(f.content ?? "")}`).join("\n\n");
      return `[Upstream Task: ${String(t.taskName ?? "")}]\nPrevious instructions: ${t.prompt ? String(t.prompt) : "(none)"}\nGenerated code:\n${fileBlocks || "(no files captured)"}`;
    })
    .join("\n\n");
}

function buildContextDescriptionsSection(contextDescriptions: unknown): string {
  if (!Array.isArray(contextDescriptions) || contextDescriptions.length === 0) return "";
  return `\n--- CONNECTED CONTEXT (read-only reference) ---\n${contextDescriptions.map((d) => String(d)).join("\n")}\n`;
}

function systemPrompt(input: ExecuteNodeInput, toolNames: string[]): string {
  const skill = asSkill(input.skill);
  const toolListText = toolNames.map((name) => TOOL_DESCRIPTIONS[name] ?? `- '${name}'`).join("\n");
  const upstreamSection = buildUpstreamSection(input.upstreamTaskContext);
  const globalContextSection = input.globalContext ? `\n--- GLOBAL CONTEXT (read-only reference) ---\n${input.globalContext}\n` : "";
  const contextDescriptionsSection = buildContextDescriptionsSection(input.contextDescriptions);
  const upstreamBlock = upstreamSection
    ? `\n--- UPSTREAM TASK CHANGES (already applied — do not redo) ---\nThe following tasks have already run and modified these files. Treat their output as the current state of the codebase.\nYOUR ONLY JOB: Make the additional changes required by YOUR instructions. Do NOT rewrite, re-implement, or reapply anything the upstream task already did. Do NOT write a file unless your task specifically requires changing it.\n${upstreamSection}\n`
    : "";

  const defaultSystemPrompt = `You are a bounded task executor — one node in a larger multi-node plan. You have a single, small, well-defined responsibility. Other nodes handle everything else.

YOUR TASK:
${input.instructions}

HARD BOUNDARIES — read these before anything else:
- You may ONLY write files that are directly and explicitly required by your task above. Nothing else.
- You may NOT create any file that was not asked for: no README, no docs, no changelogs, no extra configs, no test files, no helper utilities, no migration scripts — unless the task explicitly requests them.
- You may NOT refactor, clean up, or improve code that is outside your task scope, even if you notice issues.
- You may NOT add features, abstractions, or "while I'm at it" improvements beyond what is stated.
- You are NOT working independently. Other nodes have run before you and others will run after. Stay in your lane.

READING vs WRITING:
- You may read any file in the codebase to understand structure, conventions, or dependencies. Reading is free.
- Writing is restricted: only files your task explicitly requires.

Workspace root: ${input.workspaceRoot || "unknown"}
${buildFilesList(input.inputFiles)}
${globalContextSection}${contextDescriptionsSection}${upstreamBlock}Available tools:
${toolListText}

If any MCP integration tools appear in your tool list, call them for external data your other tools can't reach.

File writing rules:
- Write the complete file content — never partial edits or diffs.
- Write to the exact existing path. Do NOT create a renamed or duplicate file.
- Once all required files are written, stop immediately and summarize what changed.
`;

  const skillPromptTemplate = typeof skill?.systemPrompt === "string" ? skill.systemPrompt : undefined;
  const skillGuidance = skillPromptTemplate
    ? `\n\nActive skill guidance (adds to, does not replace, the boundaries above):\n${skillPromptTemplate
        .replace(/\$\{workspaceRoot\}/g, input.workspaceRoot || "unknown")
        .replace(/\$\{instructions\}/g, input.instructions)}`
    : "";

  return `${defaultSystemPrompt}${skillGuidance}`;
}

function isLspEnabled(lspSettings: unknown): boolean {
  return Boolean(lspSettings && typeof lspSettings === "object" && (lspSettings as { enabled?: unknown }).enabled);
}

export const executeNodeDefinition: CoreCapabilityDefinition<"execute_node"> = {
  capability: "execute_node",

  supports: (input) => {
    if (!mapProviderToIntegration(input.customProvider as CustomProvider, input.model).supported) return false;
    return !isLspEnabled(input.lspSettings);
  },

  recipe: (input: ExecuteNodeInput): SessionRecipe => {
    const mapped = mapProviderToIntegration(input.customProvider as CustomProvider, input.model);
    if (!mapped.supported) {
      throw new Error(`CoreHarness: execute_node cannot run on core -- ${mapped.reason}`);
    }
    const toolSpecs = toolSpecsFor(asSkill(input.skill));
    const { specs: mcpServers, skipped } = mapMcpServerConfigs(asMcpServerConfigsFromContext(input.mcpContext));
    for (const { reason } of skipped) console.warn(`[execute_node] ${reason}`);
    return {
      execution_policy: skillExecutionPolicy(input.skill, "execute"),
      workspace: { root: input.workspaceRoot, binding: "host" },
      integration: mapped.integration,
      integration_config: mapped.integration_config,
      // OpenCode Zen's gateway used to hang indefinitely above max_tokens
      // 8192, back when it ran through the host-routed browser `fetch()`
      // path with no application-level timeout -- see providerMapping.ts's
      // own `CORE_MAX_TOKENS` doc comment for why that no longer applies
      // now that it runs through rusty-core's own timeout-bounded direct
      // integrations.
      execution_params: { model: mapped.model ?? input.model, max_tokens: CORE_MAX_TOKENS, reasoning_effort: mapped.reasoningEffort },
      system_prompt: systemPrompt(
        input,
        [...toolSpecs.map((spec) => spec.name), "web_fetch"],
      ),
      host_tools: toolSpecs,
      mcp_servers: mcpServers,
      enable_web_fetch: true,
    };
  },

  promptText: (input) => `${flattenHistory(input.chatHistory)}${input.instructions}`,

  hostTools: (input, host: RunHost, ctx): Record<string, HostToolHandler> => {
    const modifiedFiles = (ctx.scratch.modifiedFiles ??= new Set<string>()) as Set<string>;
    const names = new Set(toolSpecsFor(asSkill(input.skill)).map((spec) => spec.name));
    const handlers: Record<string, HostToolHandler> = {};
    if (names.has("read_file")) handlers.read_file = readTool(input.workspaceRoot, host, input.inputFiles);
    if (names.has("write_file")) handlers.write_file = writeTool(input.workspaceRoot, host, modifiedFiles, input.inputFiles);
    if (names.has("list_files")) handlers.list_files = listFilesTool(input.workspaceRoot);
    if (names.has("search_codebase")) handlers.search_codebase = searchCodebaseTool(input.workspaceRoot);
    if (names.has("open_document")) handlers.open_document = openDocumentTool(input.workspaceRoot, input.inputFiles);
    return handlers;
  },

  toResult: (transcript: Transcript, _input, ctx): CapabilityResult<"execute_node"> => {
    const modifiedFiles = (ctx.scratch.modifiedFiles as Set<string> | undefined) ?? new Set<string>();
    return { modified: Array.from(modifiedFiles), response: transcript.lastMessageText() || "Task completed." };
  },

  usageContext: (input) => ({ workspaceRoot: input.workspaceRoot, model: input.model }),
};
