// ============================================================
// definitions/agent_chat.ts — agent_chat on rusty-core (Milestone C): the
// interactive Agent Tab / Explorer chat surface, and the biggest
// capability ported so far. Scoped to the sidecar's own "normal"
// interactive mode (`!planOnly && !vfsOnly`) -- see the scope-cut list
// below for what's deliberately not here yet.
//
// The system prompt (workspace intro, tool list, guidelines,
// user-visible-reasoning-updates and questions sections) and the tool
// name/description set are ported from
// agent-sidecar/src/capabilities/agentChat.ts. For the `!planOnly &&
// !vfsOnly` mode this definition targets, the sidecar's own
// `resolveAgentChatToolNames` (agentChatPolicy.ts) strips `write_plan`
// from the enabled set entirely (it's only ever added back for
// `planOnly`) -- so the supported tool set is
// read_file/write_file/list_files/search_codebase (reused verbatim from
// exploreTools.ts, same names execute_node already uses), web_search,
// run_command (runCommandTool.ts), plus report_progress/ask_user_question,
// which the sidecar always adds regardless of skill ("Observability is
// always available").
//
// Deliberate v1 scope cuts, documented rather than silent:
//  - No LSP tools: same reasoning and same supports() gating as global_
//    explore/execute_node's own cuts. MCP servers and web.fetch (Phase 6)
//    ARE wired -- see the block below the scope-cut list.
//  - planOnly/vfsOnly ARE wired (sidecar-removal Phase 7d) -- ported from
//    the sidecar's own `agentChatPolicy.ts::resolveAgentChatToolNames`
//    exactly: `planOnly` strips `write_file`/`run_command` from the tool
//    set and adds `write_plan` (writes a Markdown file under
//    `<workspaceRoot>/plans/`, via `RunHost.writePlan` -- already part of
//    the generic host contract and already implemented by every
//    agent_chat call site for the sidecar-routed binding, just never
//    wired to a core-routed tool before now); `vfsOnly` strips
//    `run_command`/`write_plan`. `GLOBAL_CHAT_TASK_DEPENDENCY_POLICY`
//    (below) is appended to the system prompt verbatim when `planOnly` is
//    set, ported from the same source file.
//  - run_command IS wired -- runCommandTool.ts's `gatedRunCommandTool`,
//    the permission-gated port of the sidecar's own tool: structured
//    {program, args, cwd, timeoutMs}, risk-classified and asked through
//    `RunHost.requestPermission` (the IDE's command-permission dialog,
//    whose per-session grant memory keys on `input.tabId` -- see
//    services/commandPermissionService.ts), then executed by
//    shell_exec.rs. Stripped by planOnly/vfsOnly exactly as the sidecar's
//    `resolveAgentChatToolNames` did, so only the interactive Agent Tab
//    ever offers it.
//  - Subagent delegation now uses rusty-core's own native `agent.spawn`
//    (M5, `agent_runner.rs`) instead of replicating the sidecar's
//    DelegationManager (concurrency/queuing/aggregation there is
//    rusty-core's own `AgentSupervisor`, not reimplemented here) --
//    registered unconditionally via `enable_agent_spawn` (there is no
//    `AgentChatInput` toggle to gate it on, unlike a skill-scoped tool;
//    the sidecar's own `delegate_task` is likewise always offered to a
//    managed-runtime provider, never opt-in per run). `AgentChatResult.
//    subagents` is still always `[]` on a core-routed run -- the model
//    can spawn and use subagent results in its own turn, but there is no
//    equivalent to the sidecar's live `subagent_update` event stream yet
//    for the Subagent Activity panel to render, a UI-only gap.
//  - web_search (Phase 6) IS wired -- webSearch.ts's own multi-provider
//    port, registered as a `host_tools` entry (unlike web.fetch/agent.spawn,
//    it has no rusty-core built-in equivalent, so this one stays a real
//    HostBridge round trip). Every built-in skill already lists
//    "web_search" in its `enabledTools` (skillDefinitions.ts), so it shows
//    up automatically once added to SUPPORTED_TOOL_NAMES below -- no skill
//    data needed changing. Provider API keys arrive via `input.
//    webSearchApiKeys` (AgentChatInput), resolved by the call site
//    (AgentTab.tsx/useExplorerWebSocket.ts) from store.webSearchApiKeys --
//    NOT read from the store directly in this file. This file importing
//    "../../../store" created a real circular import the first time
//    (store.ts's slice composition transitively reaches every capability
//    definition through the harness registry), caught by a full test-suite
//    run failing with "createMetricsSlice is not a function"; every other
//    definition file already avoids the store the same way mcpServers/
//    customProvider do.
// ============================================================

import { formatWorkflowOutput } from "../workflowRun";
import type { McpServerConfig } from "../../../components/mcp/types";
import type { CustomProvider } from "../../../store/types";
import type { AgentChatInput, CapabilityEvent, CapabilityResult } from "../../contract";
import type { RunHost } from "../../contract";
import type { CoreCapabilityDefinition, HostToolHandler } from "../CoreHarness";
import { NOOP_TOOL_EXECUTION_OBSERVER } from "../../contract/observability";
import { CHAT_RENDER_CHARS } from "../../../config/chatLimits";
import { hasTokens } from "../usageAccumulator";
import { mapMcpServerConfigs } from "../mcpServerMapping";
import { CORE_MAX_TOKENS, mapProviderToIntegration } from "../providerMapping";
import { skillExecutionPolicy } from "../skillExecutionPolicy";
import { mcpIntegrationsSection } from "../mcpPrompt";
import type { HostToolSpec, SessionRecipe } from "../SessionRecipe";
import type { Transcript } from "../transcript";
import { analyzeProject, formatProjectBrief } from "../projectInfo";
import { scanProject } from "../projectScan";
import { PROJECT_INFO_TOOL, projectInfoTool } from "./projectInfoTool";
import { INSTALL_DEPENDENCIES_TOOL, RUN_CHECK_TOOL, installDependenciesTool, runCheckTool } from "./runCheckTool";
import { EDIT_FILE_TOOL, LIST_FILES_TOOL, OPEN_DOCUMENT_TOOL, READ_FILE_TOOL, SEARCH_CODEBASE_TOOL, WRITE_FILE_TOOL, editTool, grantedToolName, listFilesTool, openDocumentTool, readTool, searchCodebaseTool, writeTool } from "./exploreTools";
import { flattenHistory } from "./promptHistory";
import { GATED_RUN_COMMAND_TOOL, gatedRunCommandTool } from "./runCommandTool";
import { runWebSearch, type WebSearchApiKeys, type WebSearchOptions } from "./webSearch";

function asMcpServerConfigs(value: unknown): McpServerConfig[] {
  return Array.isArray(value)
    ? value.filter((v): v is McpServerConfig => !!v && typeof v === "object" && typeof (v as McpServerConfig).name === "string")
    : [];
}

interface SkillLike {
  name?: unknown;
  enabledTools?: unknown;
  systemPrompt?: unknown;
}

function activeSkillLine(skill: SkillLike | undefined): string {
  return typeof skill?.name === "string" && skill.name
    ? `Active skill: ${skill.name}`
    : "Active skill: none (default tools)";
}

function asSkill(skill: unknown): SkillLike | undefined {
  return skill && typeof skill === "object" ? (skill as SkillLike) : undefined;
}

const WEB_SEARCH_TOOL: HostToolSpec = {
  name: "web_search",
  description: "Search the public web for current information and return an answer with source links.",
  input_schema: {
    type: "object",
    properties: {
      query: { type: "string", description: "The web search query." },
      numResults: { type: "number", description: "Number of results to return (default: 5, maximum: 20)." },
      recencyFilter: { type: "string", enum: ["day", "week", "month", "year"], description: "Optional recency filter." },
      domainFilter: { type: "array", items: { type: "string" }, description: "Optional domain allowlist; prefix a domain with '-' to exclude it." },
      provider: { type: "string", enum: ["auto", "openai", "brave", "parallel", "tavily", "exa", "perplexity", "gemini"], description: "Optional search provider; defaults to automatic selection." },
    },
    required: ["query"],
  },
};

/** Ported verbatim from agent-sidecar/src/capabilities/agentChat.ts's own
 * `write_plan` tool -- filename normalization (auto-append `.md`) and
 * validation regex included, matching what `RunHost.writePlan`'s own
 * implementations (e.g. useExplorerWebSocket.ts's createRunHost) already
 * re-validate on their side too (defense in depth, unchanged by this). */
const WRITE_PLAN_TOOL: HostToolSpec = {
  name: "write_plan",
  description: "Save a Markdown plan in the plans folder at the project root. Use this only when the user explicitly asks to save, write, or store the plan as a file.",
  input_schema: {
    type: "object",
    properties: {
      filename: { type: "string", description: "A Markdown filename such as authentication-refactor.md. Do not include a directory." },
      content: { type: "string", description: "The complete Markdown plan" },
    },
    required: ["filename", "content"],
  },
};

const TOOL_SPECS: Record<string, HostToolSpec> = {
  read_file: READ_FILE_TOOL,
  edit_file: EDIT_FILE_TOOL,
  write_file: WRITE_FILE_TOOL,
  list_files: LIST_FILES_TOOL,
  project_info: PROJECT_INFO_TOOL,
  search_codebase: SEARCH_CODEBASE_TOOL,
  open_document: OPEN_DOCUMENT_TOOL,
  web_search: WEB_SEARCH_TOOL,
  run_check: RUN_CHECK_TOOL,
  install_dependencies: INSTALL_DEPENDENCIES_TOOL,
  run_command: GATED_RUN_COMMAND_TOOL,
};
const SUPPORTED_TOOL_NAMES = Object.keys(TOOL_SPECS);

/** Ported verbatim from agentChatPolicy.ts -- appended to the system
 * prompt only when `planOnly` is set (Global Chat's own planning mode). */
const GLOBAL_CHAT_TASK_DEPENDENCY_POLICY = `
- Whenever you provide an implementation plan containing one or more tasks, the final section of your response MUST be titled "Task Dependencies and Influence". Include this section even when the user did not ask for dependency information.
- Give every planned task a stable identifier such as T1, T2, and T3, and use the same identifiers in the final dependency section.
- In that final section, list every task and state both "Depends on" and "Influences". Use "none" when there is no relationship.
- Preserve dependency, ordering, independence, and parallelism explicitly stated by the user.
- If the user did not specify task relationships, default to implementation order: T1 has no dependency, T2 depends on T1, T3 depends on T2, and so on. Each task therefore influences the next task; do not infer parallel execution unless the user requests or confirms it.
- Keep "Task Dependencies and Influence" as the final section so downstream task generation can reliably use it to create TaskNode connections.
`;

const REPORT_PROGRESS_TOOL: HostToolSpec = {
  name: "report_progress",
  description: "Publish a brief progress update and the next action to the conversation. Do not include internal reasoning.",
  input_schema: {
    type: "object",
    properties: {
      summary: { type: "string", description: "Brief evidence-based summary of what you know and why the next step is useful." },
      nextAction: { type: "string", description: "The next action you intend to take." },
    },
    required: ["summary", "nextAction"],
  },
};

const ASK_USER_QUESTION_TOOL: HostToolSpec = {
  name: "ask_user_question",
  description: "Ask the user a focused question when a product or implementation choice blocks progress. Offer 2-4 concrete suggestions whenever possible.",
  input_schema: {
    type: "object",
    properties: {
      question: { type: "string", description: "The concise question to show the user." },
      options: {
        type: "array",
        items: {
          type: "object",
          properties: {
            label: { type: "string", description: "Short selectable answer." },
            description: { type: "string", description: "Optional trade-off or explanation." },
          },
          required: ["label"],
        },
        description: "Optional 2-4 suggested answers.",
      },
    },
    required: ["question"],
  },
};

const TOOL_DESCRIPTIONS: Record<string, string> = {
  read_file: '- \'read_file\': Read any file in the workspace (input: {"path": "file/path"}).',
  edit_file: '- \'edit_file\': Change part of an existing file by replacing one exact piece of its text. Use it for every change to an existing file (input: {"path": "file/path", "old_string": "exact text to replace", "new_string": "replacement", "replace_all"?: true}).',
  write_file: '- \'write_file\': Create a new file, or replace a file\'s entire content; replacing a file that already has content needs overwrite true (input: {"path": "file/path", "content": "complete content", "overwrite"?: true}).',
  list_files: '- \'list_files\': Explore the workspace. No input gives an overview; {"path": "dir", "depth"?: 2} lists a directory; {"glob": "**/package.json"} finds files by name.',
  project_info: '- \'project_info\': Find out what kind of project this is and how to check it: the install, typecheck, lint, test and build commands, and whether dependencies are installed (input: {"path"?: "project/dir"}).',
  run_check: '- \'run_check\': Run one of the project\'s own checks and get a clear PASSED or FAILED, with the errors as file:line and whether the cause is the code or the environment (input: {"check": "typecheck" | "lint" | "test" | "build" | "format", "path"?: "project/dir", "test_name"?: "name or part of one", "test_file"?: "path/to/test/file"}; test_name and test_file run just that test).',
  install_dependencies: '- \'install_dependencies\': Install the project\'s dependencies when project_info or a check says they are missing; it is not a check, so run the check again afterwards (input: {"path"?: "project/dir"}).',
  search_codebase: '- \'search_codebase\': Search for text patterns across the codebase (input: {"pattern": "search text"}).',
  open_document: '- \'open_document\': Open, read, and extract readable content from documents including Excel (.xlsx, .xls), PDF (.pdf), Word (.docx), or CSV files (input: {"path": "document/path", "sheet"?: "Sheet1", "page"?: 1}).',
  write_plan: '- \'write_plan\': Save a Markdown plan under the project-root plans folder (input: {"filename": "descriptive-name.md", "content": "complete plan"}).',
  web_search: '- \'web_search\': Search the public web for current information and cited sources (input: {"query": "search query"}).',
  run_command: '- \'run_command\': Last-resort execution for an essential build, test, typecheck, lint, generator, or explicitly requested executable. Never use it for file inspection, search, or modification (input: {"program": "npm", "args": ["test"], "cwd": "."}).',
  report_progress: "- 'report_progress': Publish a brief progress update and the next action.",
  ask_user_question: "- 'ask_user_question': Pause for a focused user decision, optionally with selectable suggestions.",
  web_fetch: "- 'web_fetch': Fetch the contents of a URL when the user references external documentation or a webpage.",
  agent_spawn: "- 'agent_spawn': Delegate a bounded, read-only investigation or review to an independent subagent; multiple calls in one turn run concurrently.",
};

interface ChatMode {
  planOnly: boolean;
  vfsOnly: boolean;
}

/** Matches the sidecar's own `skill?.enabledTools || [defaults]` semantics
 * (see execute_node.ts's identical helper) -- an explicitly empty array is
 * NOT replaced by the default. report_progress/ask_user_question are
 * always available regardless of skill, matching the sidecar's own
 * "Observability is always available" comment -- they're pushed after
 * the skill-filtered set, not filtered themselves.
 *
 * `mode` applies `resolveAgentChatToolNames`'s exact rules on top of the
 * skill-filtered set: `planOnly` drops `write_file`/`run_command` and adds
 * `write_plan`; `vfsOnly` drops `run_command` (and `write_plan`, which
 * only `planOnly` ever adds). */
function toolSpecsFor(skill: SkillLike | undefined, mode: ChatMode): HostToolSpec[] {
  const requested = skill?.enabledTools;
  const names = Array.isArray(requested) ? requested : SUPPORTED_TOOL_NAMES;
  let structuralNames = SUPPORTED_TOOL_NAMES.filter((name) => names.includes(grantedToolName(name)));
  const runsCommands = (name: string) => name === "run_command" || name === "run_check" || name === "install_dependencies";
  if (mode.planOnly) structuralNames = structuralNames.filter((name) => name !== "write_file" && name !== "edit_file" && !runsCommands(name));
  if (mode.vfsOnly) structuralNames = structuralNames.filter((name) => !runsCommands(name));
  const structural = structuralNames.map((name) => TOOL_SPECS[name]);
  const planTool = mode.planOnly ? [WRITE_PLAN_TOOL] : [];
  return [...structural, ...planTool, REPORT_PROGRESS_TOOL, ASK_USER_QUESTION_TOOL];
}

/** The chat shows about CHAT_RENDER_CHARS of one response; anything longer
 * belongs in a file, with a short summary in chat. */
export function longResponseGuideline(toolNames: string[]): string {
  const limit = `${CHAT_RENDER_CHARS.toLocaleString("en-US")} characters`;
  if (toolNames.includes("write_file")) {
    return `- Long responses: if a response would exceed about ${limit} (a full document, report, specification, or large code listing), write the complete content to a Markdown file in the workspace with 'write_file' instead of the chat. This applies even when no file was requested. Then reply with a brief summary and the file path.`;
  }
  if (toolNames.includes("write_plan")) {
    return `- Long responses: if a response would exceed about ${limit}, save the complete content with 'write_plan' and reply with a brief summary and the plan's filename.`;
  }
  return `- Long responses: keep each response under about ${limit}. If the full answer would be longer, give a condensed answer and offer to continue with the remaining parts.`;
}

function systemPrompt(input: AgentChatInput, toolNames: string[], mcpSection: string): string {
  const skill = asSkill(input.skill);

  const baseHeader = `You are an AI coding agent operating inside the Rusty spatial development canvas.
You help the user analyze, modify, and implement code in their workspace.
For analysis requests, present the findings, supporting file references, and actionable conclusions. Keep the answer concise unless the user requests detail. Do not narrate internal deliberation or repeat the source code you read.

Workspace root: ${input.workspaceRoot || "unknown"}
${activeSkillLine(skill)}`;

  const skillPromptText = typeof skill?.systemPrompt === "string" ? skill.systemPrompt : undefined;
  const skillGuidance = skillPromptText ? `\n\nActive skill guidance (adds to, does not replace, the defaults above):\n${skillPromptText}` : "";

  const taskDependencySection = input.planOnly ? `\n\nTask planning:${GLOBAL_CHAT_TASK_DEPENDENCY_POLICY}` : "";

  if (toolNames.length === 0) {
    return `${baseHeader}

Guidelines:
- Be concise and focused. Only modify what is requested.
- Output clean code without placeholder comments.
- Once done, summarize the changes you made.
${longResponseGuideline(toolNames)}${mcpSection}${skillGuidance}${taskDependencySection}`;
  }

  const toolListText = toolNames.map((name) => TOOL_DESCRIPTIONS[name] ?? `- '${name}'`).join("\n");

  const fileGuidelines = toolNames.includes("edit_file")
    ? `- Use 'read_file' to read a file before changing it.
- Change an existing file with 'edit_file', replacing only the text that must change. Use 'write_file' only to create a new file or when a complete rewrite is really intended (replacing a file that already has content needs overwrite: true).`
    : `- Use 'read_file' to read a file before editing it.
- Use 'write_file' to write the updated content back.`;

  const projectGuideline = toolNames.includes("project_info")
    ? "\n- Before you build, test or verify, call 'project_info' to learn what kind of project this is and which commands check it; do not guess commands. If a check fails because a dependency or tool is missing, that is an environment problem: install it first instead of editing code."
    : "";

  const checkGuideline = toolNames.includes("run_check")
    ? "\n- To verify a build, call 'run_check' (typecheck, lint, test, build) instead of guessing commands with 'run_command'. Its result starts with PASSED or FAILED. Do not say something builds, passes or is fixed unless a check in this conversation reported PASSED after your last change; if one fails, fix the errors it lists and run it again. While you work on one failing test you can run just that test with 'test_name' or 'test_file', but run the whole test check before you finish. If it says the cause is the environment (a missing tool or uninstalled dependencies), call 'install_dependencies' and run the check again instead of editing code."
    : "";

  const defaultSystemPrompt = `${baseHeader}


You have access to tools:
${toolListText}${mcpSection}

Guidelines:
${fileGuidelines}${projectGuideline}${checkGuideline}
- Be concise and focused. Only modify what is requested.
- Output clean code without placeholder comments.
- Once done, summarize the changes you made.
- For an analysis or overview request, deliver the findings directly in chat. Only create a document file if requested or if the response is too long for the chat (below). A progress update or promise to provide an answer is not a final answer.
${longResponseGuideline(toolNames)}
- When a material product, UX, or architecture decision cannot be inferred safely, call 'ask_user_question' instead of guessing. Keep questions focused and offer concrete options with their trade-offs.
`;

  return `${defaultSystemPrompt}${skillGuidance}${taskDependencySection}

User-visible progress updates:
- Before the first substantive action, call 'report_progress' with a concise summary of your approach and the next action.
- Call it again whenever the evidence changes your plan or before a distinct new phase.
- Base updates on concrete context and tool results. Do not reveal private chain-of-thought or hidden reasoning; keep each update to 1-3 clear sentences.

Questions:
- When a material product, UX, or architecture decision cannot be inferred safely, call 'ask_user_question' instead of guessing. Keep questions focused and offer concrete options with their trade-offs.`;
}

function isLspEnabled(lspSettings: unknown): boolean {
  return Boolean(lspSettings && typeof lspSettings === "object" && (lspSettings as { enabled?: unknown }).enabled);
}

function reportProgressTool(onEvent: (event: CapabilityEvent<"agent_chat">) => void): HostToolHandler {
  return async (args) => {
    const parsed = args as { summary?: unknown; nextAction?: unknown } | undefined;
    const summary = String(parsed?.summary ?? "");
    const nextAction = String(parsed?.nextAction ?? "");
    onEvent({ kind: "progress", content: `${summary}\n\nNext: ${nextAction}` });
    return { ok: true, output: "Progress update shown to the user." };
  };
}

interface QuestionOption {
  label: string;
  description?: string;
}

function askUserQuestionTool(host: RunHost): HostToolHandler {
  return async (args, signal) => {
    if (!host.askQuestion) {
      return { ok: false, error: "This session cannot ask the user a question." };
    }
    const parsed = args as { question?: unknown; options?: unknown } | undefined;
    const question = String(parsed?.question ?? "");
    const rawOptions = Array.isArray(parsed?.options) ? parsed.options : [];
    const options: QuestionOption[] = rawOptions
      .filter((option): option is QuestionOption => typeof option === "object" && option !== null && typeof (option as QuestionOption).label === "string" && (option as QuestionOption).label.trim().length > 0)
      .slice(0, 4);
    try {
      const answer = await host.askQuestion({ requestId: crypto.randomUUID(), question, options }, signal);
      return { ok: true, output: answer.trim() || "The user did not provide an answer." };
    } catch (error: unknown) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  };
}

/** Ported filename normalization/validation from the sidecar's own
 * write_plan tool.execute() (agent-sidecar/src/capabilities/agentChat.ts) --
 * the actual write is `RunHost.writePlan`, already implemented by every
 * agent_chat call site (e.g. useExplorerWebSocket.ts's createRunHost). */
function writePlanTool(host: RunHost): HostToolHandler {
  return async (args, signal) => {
    if (!host.writePlan) {
      return { ok: false, error: "This session cannot save a plan file." };
    }
    const parsed = args as { filename?: unknown; content?: unknown } | undefined;
    const rawFilename = typeof parsed?.filename === "string" ? parsed.filename : "";
    const content = typeof parsed?.content === "string" ? parsed.content : "";
    const filename = rawFilename.endsWith(".md") ? rawFilename : `${rawFilename}.md`;
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,119}\.md$/.test(filename)) {
      return { ok: false, error: "Plan filename must use only letters, numbers, hyphens, or underscores and end in .md." };
    }
    try {
      const path = await host.writePlan(filename, content, signal);
      return { ok: true, output: `Plan saved to: ${path}` };
    } catch (error: unknown) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  };
}

function webSearchTool(apiKeys: WebSearchApiKeys, onEvent: (event: CapabilityEvent<"agent_chat">) => void): HostToolHandler {
  return async (args, signal, observer = NOOP_TOOL_EXECUTION_OBSERVER) => {
    const parsed = args as { query?: unknown; numResults?: unknown; recencyFilter?: unknown; domainFilter?: unknown; provider?: unknown } | undefined;
    const query = typeof parsed?.query === "string" ? parsed.query.trim() : "";
    if (!query) return { ok: false, error: "A web search query is required." };

    const options: WebSearchOptions = {
      numResults: typeof parsed?.numResults === "number" ? parsed.numResults : undefined,
      recencyFilter: typeof parsed?.recencyFilter === "string" ? (parsed.recencyFilter as WebSearchOptions["recencyFilter"]) : undefined,
      domainFilter: Array.isArray(parsed?.domainFilter) ? parsed.domainFilter.filter((d): d is string => typeof d === "string") : undefined,
      provider: typeof parsed?.provider === "string" ? (parsed.provider as WebSearchOptions["provider"]) : undefined,
      signal,
    };

    onEvent({ kind: "log", message: `Searching the web: ${query}` });
    try {
      const response = await runWebSearch(query, options, apiKeys);
      // OpenAI, Perplexity, and Gemini answer with their own LLM: attribute the
      // call and its tokens to that model. Plain search APIs are a service.
      observer.executedBy(response.model
        ? { kind: "model", purpose: "Web search", model: response.model, provider: response.provider }
        : { kind: "service", purpose: "Web search", provider: response.provider });
      if (response.usage && hasTokens(response.usage)) observer.usage(response.usage);
      observer.step("info", "web search completed", { provider: response.provider, model: response.model, results: response.results.length });
      const sources = response.results.map((r, i) => `${i + 1}. ${r.title}\n   ${r.url}${r.snippet ? `\n   ${r.snippet}` : ""}`).join("\n");
      onEvent({ kind: "log", message: `Web search completed via ${response.provider}: ${response.results.length} source(s).` });
      return {
        ok: true,
        output: [
          `Web search provider: ${response.provider}`,
          response.answer || "The search returned sources without a synthesized answer.",
          sources ? `Sources:\n${sources}` : "No sources were returned.",
        ].join("\n\n"),
      };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      onEvent({ kind: "log", message: `Web search failed for "${query}": ${message}` });
      observer.step("error", "web search failed", { query, error: message });
      return { ok: false, error: message };
    }
  };
}

export const agentChatDefinition: CoreCapabilityDefinition<"agent_chat"> = {
  capability: "agent_chat",

  supports: (input) => {
    if (!mapProviderToIntegration(input.customProvider as CustomProvider, input.model).supported) return false;
    if (isLspEnabled(input.lspSettings)) return false;
    return true;
  },

  recipe: (input: AgentChatInput): SessionRecipe => {
    const mapped = mapProviderToIntegration(input.customProvider as CustomProvider, input.model);
    if (!mapped.supported) {
      throw new Error(`CoreHarness: agent_chat cannot run on core -- ${mapped.reason}`);
    }
    const mode: ChatMode = { planOnly: Boolean(input.planOnly), vfsOnly: Boolean(input.vfsOnly) };
    const toolSpecs = toolSpecsFor(asSkill(input.skill), mode);
    const mcpConfigs = asMcpServerConfigs(input.mcpServers);
    const { specs: mcpServers, skipped } = mapMcpServerConfigs(mcpConfigs);
    for (const { reason } of skipped) console.warn(`[agent_chat] ${reason}`);
    const executionPolicy = skillExecutionPolicy(
      input.skill,
      mode.planOnly ? "plan" : mode.vfsOnly ? "virtual" : "execute",
      mcpServers.map((spec) => spec.name),
    );
    return {
      execution_policy: executionPolicy,
      workspace: { root: input.workspaceRoot, binding: "host" },
      integration: mapped.integration,
      integration_config: mapped.integration_config,
      execution_params: { model: mapped.model ?? input.model, max_tokens: CORE_MAX_TOKENS, reasoning_effort: mapped.reasoningEffort },
      system_prompt: systemPrompt(
        input,
        [...toolSpecs.map((spec) => spec.name), "web_fetch", "agent_spawn"],
        mcpIntegrationsSection(mcpServers, mcpConfigs, executionPolicy),
      ),
      host_tools: toolSpecs,
      mcp_servers: mcpServers,
      enable_web_fetch: true,
      enable_agent_spawn: true,
    };
  },

  // The detected project goes into the prompt only when the model can also ask
  // for the details (`project_info`), and never at the cost of a run: see
  // `enrichedRecipe`.
  enrichRecipe: async (recipe, input, host, signal) => {
    if (!recipe.host_tools?.some((tool) => tool.name === "project_info") || !input.workspaceRoot.trim()) return undefined;
    const brief = formatProjectBrief(await analyzeProject(await scanProject(input.workspaceRoot, host, signal)));
    return brief ? { ...recipe, system_prompt: `${recipe.system_prompt ?? ""}\n\n${brief}` } : undefined;
  },

  promptText: (input) => `${flattenHistory(input.chatHistory)}${input.message}`,

  hostTools: (input, host: RunHost, ctx, onEvent): Record<string, HostToolHandler> => {
    const modifiedFiles = (ctx.scratch.modifiedFiles ??= new Set<string>()) as Set<string>;
    const mode: ChatMode = { planOnly: Boolean(input.planOnly), vfsOnly: Boolean(input.vfsOnly) };
    const names = new Set(toolSpecsFor(asSkill(input.skill), mode).map((spec) => spec.name));
    const handlers: Record<string, HostToolHandler> = {};
    if (names.has("read_file")) handlers.read_file = readTool(input.workspaceRoot, host);
    if (names.has("edit_file")) handlers.edit_file = editTool(input.workspaceRoot, host, modifiedFiles);
    if (names.has("write_file")) handlers.write_file = writeTool(input.workspaceRoot, host, modifiedFiles);
    if (names.has("list_files")) handlers.list_files = listFilesTool(input.workspaceRoot);
    if (names.has("project_info")) handlers.project_info = projectInfoTool(input.workspaceRoot, host);
    if (names.has("search_codebase")) handlers.search_codebase = searchCodebaseTool(input.workspaceRoot);
    if (names.has("open_document")) handlers.open_document = openDocumentTool(input.workspaceRoot);
    if (names.has("web_search")) handlers.web_search = webSearchTool((input.webSearchApiKeys ?? {}) as WebSearchApiKeys, onEvent);
    if (names.has("write_plan")) handlers.write_plan = writePlanTool(host);
    if (names.has("run_check")) handlers.run_check = runCheckTool({ workspaceRoot: input.workspaceRoot, sessionId: input.tabId, host, onEvent });
    if (names.has("install_dependencies")) handlers.install_dependencies = installDependenciesTool({ workspaceRoot: input.workspaceRoot, sessionId: input.tabId, host, onEvent });
    if (names.has("run_command")) handlers.run_command = gatedRunCommandTool({ workspaceRoot: input.workspaceRoot, sessionId: input.tabId, host, onEvent });
    handlers.report_progress = reportProgressTool(onEvent);
    handlers.ask_user_question = askUserQuestionTool(host);
    return handlers;
  },

  toResult: (transcript: Transcript, _input, ctx): CapabilityResult<"agent_chat"> => {
    const modifiedFiles = (ctx.scratch.modifiedFiles as Set<string> | undefined) ?? new Set<string>();
    return { response: transcript.lastMessageText() || "Task completed.", modifiedFiles: Array.from(modifiedFiles), subagents: [] };
  },

  usageContext: (input) => ({ workspaceRoot: input.workspaceRoot, model: input.model }),

  workflow: (input) => input.workflow,

  workflowResult: (output, _input, ctx): CapabilityResult<"agent_chat"> => {
    const modifiedFiles = (ctx.scratch.modifiedFiles as Set<string> | undefined) ?? new Set<string>();
    return { response: formatWorkflowOutput(output), modifiedFiles: Array.from(modifiedFiles), subagents: [] };
  },
};
