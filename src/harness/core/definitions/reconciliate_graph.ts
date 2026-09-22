// ============================================================
// definitions/reconciliate_graph.ts — reconciliate_graph on rusty-core
// (Milestone C): the first genuine `orchestrate` capability. Unlike
// reconciliate_edge (one session, one tool loop), the sidecar's actual
// reconciliateGraph.ts runs one INDEPENDENT session per overlapping file
// (a file touched by more than one task node), sequentially, each scoped
// to read/write exactly that one file -- CoreHarness has no notion of
// "one capability run, several sessions" until this file's own need for
// it, which is why CoreHarness.ts gained the `orchestrate`/`runSession`
// primitive alongside this port (see its own doc comments there).
//
// The system prompt, the per-file context-compaction helpers
// (truncateContextText/compactChatHistory/compactFileContext), the
// per-file tool restriction (each session's read_file/write_file can only
// touch the one file it was given), and the overall algorithm (build
// context for a file -> run one session -> finalize -- write back
// unchanged content if the model didn't write -- -> move to the next
// file, aborting the whole run on the first file's failure) are ported
// from agent-sidecar/src/capabilities/reconciliateGraph.ts.
//
// Two deliberate v1 simplifications, both documented rather than silent:
//  - No stale-VFS-key rebasing. The sidecar's own `normalizeWorkspaceFile`
//    has a recovery path for a saved canvas whose absolute file paths
//    predate a workspace root that later moved (rebasing them onto the
//    currently open root by matching path components). This port's own
//    `resolveWorkspaceFile` only handles the ordinary case -- a relative
//    path, or an absolute path already inside the current workspace root
//    -- and throws a clear error otherwise. Rare recovery scenario, not
//    everyday usage; worth porting properly if it turns out to matter.
//  - No `returnAfterToolNames: ["write_file"]` short-circuit. The
//    sidecar's own per-file tool loop (`callLlmWithToolsPiStreaming`)
//    stops immediately after a successful `write_file` call, skipping a
//    redundant final model turn that would otherwise just restate the
//    file it already wrote. rusty-core's own `agent_runner.rs` is the
//    sole turn-loop orchestrator for a host-routed session and exposes no
//    equivalent "stop after this tool succeeds" signal -- a core-routed
//    file case runs one extra turn per file until the model itself
//    decides to stop. A cost/latency difference, not a correctness one.
// ============================================================

import type { CustomProvider } from "../../../store/types";
import type { CapabilityResult } from "../../contract";
import type { RunHost } from "../../contract";
import type { CoreCapabilityDefinition, HostToolHandler } from "../CoreHarness";
import { CORE_MAX_TOKENS, mapProviderToIntegration } from "../providerMapping";
import type { HostToolSpec } from "../SessionRecipe";
import { flattenHistory } from "./promptHistory";

interface ReconciliationNode {
  id: string;
  name?: string;
  prompt?: string;
  chatHistory?: unknown[];
  modifiedFiles?: string[];
  originalFileContents?: Record<string, string>;
  generatedFileContents?: Record<string, string>;
}

interface OverlappingFileTask {
  id: string;
  name: string;
  instructions: string;
  chatHistory: unknown[];
  generatedContent?: string;
}

interface OverlappingFileContext {
  path: string;
  currentVfsContent: string;
  tasks: OverlappingFileTask[];
}

const MAX_TASK_INSTRUCTION_CHARS = 4_000;
const MAX_TASK_CHAT_MESSAGES = 4;
const MAX_TASK_CHAT_CHARS = 4_000;
const MAX_RECONCILIATION_CHAT_MESSAGES = 4;
const MAX_RECONCILIATION_CHAT_CHARS = 4_000;
const MAX_REPORT_CHARS = 4_000;
const MAX_RESPONSE_CHARS = 24_000;

function truncateContextText(value: unknown, maxChars: number): string {
  const text = typeof value === "string" ? value : JSON.stringify(value ?? "");
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}\n[...older context truncated...]`;
}

function compactChatHistory(history: unknown[], maxMessages: number, maxChars: number): string[] {
  const messages = history.slice(-maxMessages).map((entry) => {
    if (entry && typeof entry === "object") {
      const role = "role" in entry && typeof (entry as { role?: unknown }).role === "string" ? (entry as { role: string }).role : "message";
      const content = "content" in entry ? (entry as { content?: unknown }).content : entry;
      return `${role}: ${truncateContextText(content, maxChars)}`;
    }
    return truncateContextText(entry, maxChars);
  });

  const compacted: string[] = [];
  let remaining = maxChars;
  for (let index = messages.length - 1; index >= 0 && remaining > 0; index -= 1) {
    const message = messages[index];
    const kept = message.slice(Math.max(0, message.length - remaining));
    compacted.unshift(kept);
    remaining -= kept.length;
  }
  return compacted;
}

/** Build a context payload for exactly one overlapping file, deduping
 * identical generated versions across tasks the same way the sidecar's
 * own compactFileContext does. */
function compactFileContext(file: OverlappingFileContext): Record<string, unknown> {
  const includedVersions = new Map<string, string>();
  return {
    path: file.path,
    currentVfsContent: file.currentVfsContent,
    tasks: file.tasks.map((task) => {
      let generatedVersion: Record<string, unknown>;
      if (task.generatedContent === undefined) {
        generatedVersion = { available: false };
      } else if (task.generatedContent === file.currentVfsContent) {
        generatedVersion = { available: true, sameAsCurrentVfs: true };
      } else if (includedVersions.has(task.generatedContent)) {
        generatedVersion = { available: true, sameAsTask: includedVersions.get(task.generatedContent) };
      } else {
        includedVersions.set(task.generatedContent, task.id);
        generatedVersion = { available: true, content: task.generatedContent };
      }
      return {
        id: task.id,
        name: task.name,
        instructions: truncateContextText(task.instructions, MAX_TASK_INSTRUCTION_CHARS),
        recentChat: compactChatHistory(task.chatHistory, MAX_TASK_CHAT_MESSAGES, MAX_TASK_CHAT_CHARS),
        generatedVersion,
      };
    }),
  };
}

/** Resolves a model-given or task-recorded path against `workspaceRoot`
 * (relative paths joined on; an already-absolute path must already be
 * inside the workspace) -- see this file's header comment on the
 * stale-VFS-key rebasing this deliberately doesn't replicate. */
function resolveWorkspaceFile(workspaceRoot: string, filePath: string): string {
  if (!workspaceRoot?.trim()) throw new Error("No workspace root is available for reconciliation.");
  if (typeof filePath !== "string" || !filePath.trim()) throw new Error("A file path is required.");
  const isAbsolute = filePath.startsWith("/") || /^[a-zA-Z]:[\\/]/.test(filePath);
  const root = workspaceRoot.endsWith("/") ? workspaceRoot.slice(0, -1) : workspaceRoot;
  const resolved = isAbsolute ? filePath : `${root}/${filePath}`;
  const withinRoot = resolved === root || resolved.startsWith(`${root}/`);
  if (!withinRoot) throw new Error(`Reconciliation file must be inside the workspace: ${filePath}`);
  return resolved;
}

function normalizeFileSources(workspaceRoot: string, fileSources: Record<string, string> | undefined): Map<string, string> {
  const normalized = new Map<string, string>();
  for (const [workspacePath, vfsPath] of Object.entries(fileSources ?? {})) {
    const destination = resolveWorkspaceFile(workspaceRoot, workspacePath);
    const source = resolveWorkspaceFile(workspaceRoot, vfsPath);
    if (source !== destination) {
      throw new Error(`VFS source does not match its active workspace file: ${vfsPath}`);
    }
    normalized.set(destination, source);
  }
  return normalized;
}

function normalizeDuplicateEntries(workspaceRoot: string, duplicateFiles: Record<string, string[]>): Array<[string, string[]]> {
  const groups = new Map<string, Set<string>>();
  for (const [filePath, taskIds] of Object.entries(duplicateFiles)) {
    const workspacePath = resolveWorkspaceFile(workspaceRoot, filePath);
    const owners = groups.get(workspacePath) ?? new Set<string>();
    for (const taskId of taskIds ?? []) owners.add(taskId);
    groups.set(workspacePath, owners);
  }
  return Array.from(groups, ([filePath, owners]) => [filePath, Array.from(owners)]);
}

function contentAtPath(contents: Record<string, string> | undefined, workspaceRoot: string, resolvedPath: string): string | undefined {
  for (const [filePath, content] of Object.entries(contents ?? {})) {
    try {
      if (resolveWorkspaceFile(workspaceRoot, filePath) === resolvedPath) return content;
    } catch {
      // Ignore an invalid snapshot key; it cannot describe this overlap.
    }
  }
  return undefined;
}

function asReconciliationNodes(nodes: unknown): ReconciliationNode[] {
  if (!Array.isArray(nodes)) return [];
  return nodes.filter((node): node is ReconciliationNode => typeof node === "object" && node !== null && typeof (node as { id?: unknown }).id === "string");
}

/** Build the exact model input from the live workspace and each colliding
 * task's saved version -- mirrors the sidecar's own
 * buildOverlappingFileContext, generalized to exactly one file at a time
 * the way this definition's own per-file loop already calls it. */
async function buildOverlappingFileContext(options: {
  workspaceRoot: string;
  filePath: string;
  taskIds: string[];
  nodes: ReconciliationNode[];
  sourcePath: string;
  readFile: (absolutePath: string) => Promise<string>;
}): Promise<OverlappingFileContext> {
  const nodesById = new Map(options.nodes.map((node) => [node.id, node]));
  const currentVfsContent = await options.readFile(options.sourcePath);
  const tasks: OverlappingFileTask[] = options.taskIds.map((taskId) => {
    const node = nodesById.get(taskId);
    return {
      id: taskId,
      name: node?.name || "Unnamed Task",
      instructions: node?.prompt || "",
      chatHistory: Array.isArray(node?.chatHistory) ? node.chatHistory : [],
      generatedContent: contentAtPath(node?.generatedFileContents, options.workspaceRoot, options.filePath),
    };
  });
  return { path: options.filePath, currentVfsContent, tasks };
}

function systemPrompt(workspaceRoot: string): string {
  return `You are a code reconciliation model inside a spatial development canvas called Rusty.

WHAT HAPPENED:
The user broke a larger plan into small, bounded task nodes. Each node executed independently with its own specific instructions and produced its own version of certain files. The file you are about to receive was touched by multiple task nodes — meaning each of them had a legitimate requirement for that file and produced their own implementation of it.

YOUR JOB — SYNTHESIS, NOT ARBITRATION:
You are not picking a winner. You are not fixing a merge conflict. You are producing a single version of the file that simultaneously satisfies the requirements of every task node that touched it. Think of it as: "what would this file look like if one developer had read all the task instructions and implemented all of them together?"

HOW TO APPROACH IT:
1. Read each task's instructions carefully. Understand what that task needed this file to do.
2. Read each task's generated version. Understand how it chose to implement its requirement.
3. The current VFS content is the last task's version — it may satisfy some requirements but not others.
4. Produce a final version that implements everything all tasks required. Do not omit any task's contribution unless it directly contradicts another (in which case, apply the one that best fits the overall intent).
5. If the current VFS version already satisfies all task requirements with no gaps, do not rewrite it — just confirm it.

RULES:
- You may only read and write the single file supplied to you. No other files.
- Write the complete file — never a partial edit, snippet, or diff.
- Write to the exact supplied path only.
- Do not run builds, tests, or shell commands. All writes go to the VFS via 'write_file'.
- Finish with a concise summary: what each task required, what changed, and why.

Workspace root: ${workspaceRoot || "unknown"}
`;
}

const READ_FILE_TOOL: HostToolSpec = {
  name: "read_file",
  description: "Re-read the current canvas VFS version of this one overlapping file.",
  input_schema: {
    type: "object",
    properties: { path: { type: "string", description: "The exact supplied overlapping file path" } },
    required: ["path"],
  },
};

const WRITE_FILE_TOOL: HostToolSpec = {
  name: "write_file",
  description: "Replace this one overlapping file in the canvas VFS with its complete reconciled content.",
  input_schema: {
    type: "object",
    properties: {
      path: { type: "string", description: "The exact supplied overlapping file path" },
      content: { type: "string", description: "Complete replacement file content" },
    },
    required: ["path", "content"],
  },
};

function readFileTool(host: RunHost, workspaceRoot: string, targetPath: string, sourcePath: string): HostToolHandler {
  return async (args, signal) => {
    const filePath = String((args as { path?: unknown } | undefined)?.path ?? "");
    let resolved: string;
    try {
      resolved = resolveWorkspaceFile(workspaceRoot, filePath);
    } catch (error: unknown) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
    if (resolved !== targetPath) {
      return { ok: false, error: `This reconciliation case can only read ${targetPath}` };
    }
    try {
      const content = await host.readFile(sourcePath, signal);
      return { ok: true, output: content };
    } catch (error: unknown) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  };
}

function writeFileTool(host: RunHost, workspaceRoot: string, targetPath: string, sourcePath: string, modifiedFiles: Set<string>): HostToolHandler {
  return async (args, signal) => {
    const parsed = args as { path?: unknown; content?: unknown } | undefined;
    const filePath = String(parsed?.path ?? "");
    const content = String(parsed?.content ?? "");
    let resolved: string;
    try {
      resolved = resolveWorkspaceFile(workspaceRoot, filePath);
    } catch (error: unknown) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
    if (resolved !== targetPath) {
      return { ok: false, error: `This reconciliation case can only change ${targetPath}` };
    }
    try {
      const currentContent = await host.readFile(sourcePath, signal);
      if (currentContent === content) {
        return { ok: true, output: `No write was needed because ${targetPath} already has that content.` };
      }
      await host.writeFile(targetPath, content, signal);
      modifiedFiles.add(targetPath);
      return { ok: true, output: `File successfully finalized under the reconciliation owner in the canvas VFS: ${targetPath}` };
    } catch (error: unknown) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  };
}

export const reconciliateGraphDefinition: CoreCapabilityDefinition<"reconciliate_graph"> = {
  capability: "reconciliate_graph",

  supports: (input) => mapProviderToIntegration(input.customProvider as CustomProvider, input.model).supported,

  orchestrate: async ({ input, host, onEvent, signal, runSession }) => {
    const mapped = mapProviderToIntegration(input.customProvider as CustomProvider, input.model);
    if (!mapped.supported) {
      throw new Error(`CoreHarness: reconciliate_graph cannot run on core -- ${mapped.reason}`);
    }

    const nodes = asReconciliationNodes(input.nodes);
    const normalizedSources = normalizeFileSources(input.workspaceRoot, input.fileSources);
    const duplicateEntries = normalizeDuplicateEntries(input.workspaceRoot, input.duplicateFiles ?? {});

    const sourceForPath = new Map<string, string>();
    for (const node of nodes) {
      for (const filePath of node.modifiedFiles ?? []) {
        const resolved = resolveWorkspaceFile(input.workspaceRoot, filePath);
        const source = normalizedSources.get(resolved) ?? resolved;
        if (!sourceForPath.has(resolved) || source === resolved) sourceForPath.set(resolved, source);
      }
    }
    for (const [filePath] of duplicateEntries) {
      if (!sourceForPath.has(filePath)) sourceForPath.set(filePath, normalizedSources.get(filePath) ?? filePath);
    }
    if (sourceForPath.size === 0) {
      throw new Error("No task-owned VFS files are available to reconcile.");
    }

    if (duplicateEntries.length === 0) {
      const result: CapabilityResult<"reconciliate_graph"> = {
        response: "No unreconciled overlapping task files were supplied. Ordinary changed files remain TaskNode-owned for Apply Rusty.",
        reviewedFiles: [],
        reconciledFiles: [],
        modifiedFiles: [],
      };
      return result;
    }

    onEvent({
      kind: "log",
      message: `Reviewing ${duplicateEntries.length} overlapping file${duplicateEntries.length === 1 ? "" : "s"} one at a time with ${input.model}.`,
    });

    const priorChat = Array.isArray(input.chatHistory) ? (input.userMessage ? input.chatHistory.slice(0, -1) : input.chatHistory) : [];
    const recentReconciliationChat = compactChatHistory(priorChat, MAX_RECONCILIATION_CHAT_MESSAGES, MAX_RECONCILIATION_CHAT_CHARS);

    const reviewedFiles: string[] = [];
    const finalizedFiles = new Set<string>();
    const modelModifiedFiles = new Set<string>();
    const reports: string[] = [];

    for (const [filePath, taskIds] of duplicateEntries) {
      const sourcePath = sourceForPath.get(filePath) ?? filePath;
      const fileContext = await buildOverlappingFileContext({
        workspaceRoot: input.workspaceRoot,
        filePath,
        taskIds,
        nodes,
        sourcePath,
        readFile: (absolutePath) => host.readFile(absolutePath, signal),
      });
      reviewedFiles.push(fileContext.path);

      const taskCount = fileContext.tasks.length;
      const taskNames = fileContext.tasks.map((task) => task.name).join(", ");
      const defaultMessage = `This file was modified by ${taskCount} task node${taskCount === 1 ? "" : "s"} (${taskNames}). Each task had its own bounded instructions and produced its own version. Produce a single version of this file that satisfies all ${taskCount === 1 ? "its" : "their"} requirements simultaneously.`;
      const historyText = flattenHistory(recentReconciliationChat.map((line) => ({ role: "user", content: line })));
      const promptText = `${input.userMessage?.trim() || defaultMessage}

${historyText ? `Recent reconciliation conversation (bounded):\n${recentReconciliationChat.join("\n\n")}\n\n` : ""}File modified by multiple task nodes — full context below:
${JSON.stringify(compactFileContext(fileContext), null, 2)}`;

      try {
        const transcript = await runSession({
          recipe: {
            workspace: { root: input.workspaceRoot, binding: "host" },
            integration: mapped.integration,
            integration_config: mapped.integration_config,
            execution_params: { model: mapped.model ?? input.model, max_tokens: CORE_MAX_TOKENS, reasoning_effort: mapped.reasoningEffort },
            system_prompt: systemPrompt(input.workspaceRoot),
            host_tools: [READ_FILE_TOOL, WRITE_FILE_TOOL],
          },
          promptText,
          hostTools: {
            read_file: readFileTool(host, input.workspaceRoot, fileContext.path, sourcePath),
            write_file: writeFileTool(host, input.workspaceRoot, fileContext.path, sourcePath, modelModifiedFiles),
          },
          onLog: (message) => onEvent({ kind: "log", message }),
        });

        const fileReport = transcript.lastMessageText() || "Reviewed with no changes.";
        reports.push(`${fileContext.path}\n${truncateContextText(fileReport, MAX_REPORT_CHARS)}`);

        if (!modelModifiedFiles.has(fileContext.path)) {
          // The model reviewed the file but didn't call write_file (it
          // judged the current content already satisfies every task) --
          // finalize it unchanged, same as the sidecar's own fallback.
          const finalContent = await host.readFile(sourcePath, signal);
          await host.writeFile(fileContext.path, finalContent, signal);
        }
        finalizedFiles.add(fileContext.path);

        onEvent({
          kind: "file_complete",
          filePath: fileContext.path,
          taskIds,
          modified: modelModifiedFiles.has(fileContext.path),
          response: truncateContextText(fileReport, MAX_REPORT_CHARS),
        });
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        onEvent({ kind: "file_error", filePath: fileContext.path, taskIds, error: message });
        throw new Error(`Failed while reconciling ${fileContext.path}: ${message}`);
      }
    }

    const result: CapabilityResult<"reconciliate_graph"> = {
      response: truncateContextText(reports.join("\n\n---\n\n"), MAX_RESPONSE_CHARS),
      reviewedFiles,
      reconciledFiles: Array.from(finalizedFiles),
      modifiedFiles: Array.from(modelModifiedFiles),
    };
    return result;
  },

  usageContext: (input) => ({ workspaceRoot: input.workspaceRoot, model: input.model }),
};
