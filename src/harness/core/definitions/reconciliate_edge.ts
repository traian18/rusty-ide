// ============================================================
// definitions/reconciliate_edge.ts — reconciliate_edge on rusty-core
// (Milestone C): checks whether a SOURCE task's file changes conflict
// with a TARGET task's requirements, and applies a fix if asked. Despite
// this document's own Milestone C table calling it an `orchestrate`
// capability (one session per overlapping file), the sidecar's actual
// implementation (agent-sidecar/src/capabilities/reconciliateEdge.ts) is
// a single session with the same read_file/write_file/list_files/
// search_codebase tool loop execute_node/agent_chat already use --
// simpler than either of those (no skill, no MCP, no LSP, no delegation
// at all in the sidecar version to begin with), so this port needs no
// new infrastructure and no scope cuts.
//
// The system prompt and tool set are copied verbatim from
// reconciliateEdge.ts; read_file/write_file/list_files/search_codebase
// reuse exploreTools.ts's existing builders (same tool names
// execute_node/agent_chat already use). Unlike execute_node/agent_chat,
// the result shape (`{response: string}`, capabilities.ts) carries no
// modified-files list -- matching the sidecar's own
// `reconciliation_complete` message, which never sent one either -- so
// this definition doesn't need RunContext at all.
// ============================================================

import type { CustomProvider } from "../../../store/types";
import type { CapabilityResult, ReconciliateEdgeInput } from "../../contract";
import type { RunHost } from "../../contract";
import type { CoreCapabilityDefinition, HostToolHandler } from "../CoreHarness";
import { CORE_MAX_TOKENS, mapProviderToIntegration } from "../providerMapping";
import type { HostToolSpec, SessionRecipe } from "../SessionRecipe";
import type { Transcript } from "../transcript";
import { LIST_FILES_TOOL, READ_FILE_TOOL, SEARCH_CODEBASE_TOOL, WRITE_FILE_TOOL, listFilesTool, readTool, searchCodebaseTool, writeTool } from "./exploreTools";
import { flattenHistory } from "./promptHistory";

const RECONCILIATE_EDGE_TOOLS: HostToolSpec[] = [READ_FILE_TOOL, WRITE_FILE_TOOL, LIST_FILES_TOOL, SEARCH_CODEBASE_TOOL];

const DEFAULT_USER_MESSAGE = "Check for code conflicts between the tasks and reconcile if needed.";

function filesInfo(modifiedFiles: unknown): string {
  const paths = Array.isArray(modifiedFiles) ? modifiedFiles.map(String).filter(Boolean) : [];
  return paths.length > 0 ? `Files modified by source task: ${paths.join(", ")}` : "No files were modified by the source task.";
}

function systemPrompt(input: ReconciliateEdgeInput): string {
  const userMessage = input.userMessage || DEFAULT_USER_MESSAGE;
  return `You are a code reconciliation assistant inside a spatial development canvas.
You are checking whether the code changes made by a SOURCE task are compatible with a TARGET task's requirements.

${filesInfo(input.modifiedFiles)}

Source task instructions: ${input.sourcePrompt || "(not provided)"}
Target task instructions: ${input.targetPrompt || "(not provided)"}

User message: ${userMessage}

Your job:
1. Read the modified files to understand what changes were made.
2. Analyze whether these changes conflict with the target task's requirements.
3. If there are conflicts, explain them clearly and suggest fixes.
4. If the user asks you to fix conflicts, use 'write_file' to apply the resolution.
5. CRITICAL: When making changes to a file, write the complete file with all changes included to the EXACT same path. Do NOT create a new/duplicate file with a similar or modified name. You must replace/overwrite the existing file. Never write partial code or snippets.

Workspace root: ${input.workspaceRoot || "unknown"}
`;
}

export const reconciliateEdgeDefinition: CoreCapabilityDefinition<"reconciliate_edge"> = {
  capability: "reconciliate_edge",

  supports: (input) => mapProviderToIntegration(input.customProvider as CustomProvider, input.model).supported,

  recipe: (input: ReconciliateEdgeInput): SessionRecipe => {
    const mapped = mapProviderToIntegration(input.customProvider as CustomProvider, input.model);
    if (!mapped.supported) {
      throw new Error(`CoreHarness: reconciliate_edge cannot run on core -- ${mapped.reason}`);
    }
    return {
      workspace: { root: input.workspaceRoot, binding: "host" },
      integration: mapped.integration,
      integration_config: mapped.integration_config,
      execution_params: { model: mapped.model ?? input.model, max_tokens: CORE_MAX_TOKENS, reasoning_effort: mapped.reasoningEffort },
      system_prompt: systemPrompt(input),
      host_tools: RECONCILIATE_EDGE_TOOLS,
    };
  },

  promptText: (input) => `${flattenHistory(input.chatHistory ?? [])}${input.userMessage || DEFAULT_USER_MESSAGE}`,

  hostTools: (input, host: RunHost): Record<string, HostToolHandler> => ({
    read_file: readTool(input.workspaceRoot, host),
    // No RunContext tracking here -- reconciliate_edge's own result shape
    // never reports which files it wrote (see this file's header comment),
    // so writeTool's modifiedFiles set is a throwaway.
    write_file: writeTool(input.workspaceRoot, host, new Set<string>()),
    list_files: listFilesTool(input.workspaceRoot),
    search_codebase: searchCodebaseTool(input.workspaceRoot),
  }),

  toResult: (transcript: Transcript): CapabilityResult<"reconciliate_edge"> => ({
    response: transcript.lastMessageText() || "Reconciliation completed.",
  }),

  usageContext: (input) => ({ workspaceRoot: input.workspaceRoot, model: input.model }),
};
