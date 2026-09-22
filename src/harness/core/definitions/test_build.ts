// ============================================================
// definitions/test_build.ts — test_build on rusty-core (Milestone C):
// runs the workspace's own configured build command, and on failure asks
// the model to fix the reconciled files in place before retrying, up to
// MAX_ATTEMPTS times. The second `orchestrate` capability (after
// reconciliate_graph): one rusty-core session per FIX ATTEMPT, not one
// per capability run -- the build command itself runs directly, outside
// any session's tool loop, exactly like the sidecar's own testBuild.ts
// calls `executeCommand` directly rather than exposing it as a tool.
//
// The system/user prompts, the MAX_ATTEMPTS/timeout/output-truncation
// constants, and the overall algorithm (run the build; on success,
// return the reconciled files' current disk content; on failure -- unless
// this was the last attempt -- ask the model to fix them with
// read_file/write_file/run_command, then loop) are ported verbatim from
// agent-sidecar/src/capabilities/testBuild.ts. Real disk, not VFS
// (`workspace: "disk"` in the plan's own Milestone C table): both the
// build command and the fix session's own read_file/write_file/
// run_command operate on the workspace's actual files via
// read_file_disk/write_file_disk/run_shell_command (the same Tauri
// commands the file tree and search panel already use), never through
// `RunHost`'s VFS-aware read/write the other capabilities use -- fixing
// reconciled-but-unapplied files needs the real disk state a build
// command will actually see.
//
// One v1 gap, documented rather than silent: no live streaming of build/
// diagnostic command output. The sidecar streams each output chunk as it
// arrives; `run_shell_command` (src-tauri/src/shell_exec.rs) is
// request/response -- the full captured output is only available once
// the command exits or times out. The model still sees the complete
// output once a command finishes (functionally equivalent); the UI just
// doesn't show it live, mid-command, the way the sidecar's own log
// stream does. Real streaming would need a second, event-based Tauri
// primitive -- worth adding later if this turns out to matter for a
// build that runs for minutes.
// ============================================================

import { invoke } from "@tauri-apps/api/core";

import type { CustomProvider } from "../../../store/types";
import type { CapabilityResult } from "../../contract";
import type { CoreCapabilityDefinition, HostToolHandler } from "../CoreHarness";
import { mapProviderToIntegration } from "../providerMapping";
import type { HostToolSpec } from "../SessionRecipe";
import { RUN_COMMAND_TOOL, runCommandTool, runShellCommand } from "./shellExec";

const MAX_ATTEMPTS = 5;
const BUILD_TIMEOUT_MS = 5 * 60_000;
const MAX_BUILD_OUTPUT_CHARS = 12_000;

const READ_FILE_TOOL: HostToolSpec = {
  name: "read_file",
  description: "Read a file from disk.",
  input_schema: {
    type: "object",
    properties: { path: { type: "string", description: "Absolute or workspace-relative file path" } },
    required: ["path"],
  },
};

const WRITE_FILE_TOOL: HostToolSpec = {
  name: "write_file",
  description: "Write a fixed version of a reconciled file to disk.",
  input_schema: {
    type: "object",
    properties: {
      path: { type: "string", description: "Absolute or workspace-relative file path" },
      content: { type: "string", description: "The complete fixed file content" },
    },
    required: ["path", "content"],
  },
};

/** Not shared with exploreTools.ts's own `resolveWorkspacePath` or
 * reconciliate_graph.ts's own `resolveWorkspaceFile`: this one has no
 * "must be inside the workspace" validation (matching the sidecar's own
 * simple `path.isAbsolute(filePath) ? filePath : path.join(workspaceRoot,
 * filePath)` for this specific capability) -- the two other versions each
 * validate differently for their own capability's needs, so unifying all
 * three would either weaken one or complicate another for no shared
 * benefit. */
function resolveDiskPath(workspaceRoot: string, filePath: string): string {
  if (filePath.startsWith("/") || /^[a-zA-Z]:[\\/]/.test(filePath)) return filePath;
  const sep = workspaceRoot.includes("\\") && !workspaceRoot.includes("/") ? "\\" : "/";
  return workspaceRoot.endsWith(sep) ? `${workspaceRoot}${filePath}` : `${workspaceRoot}${sep}${filePath}`;
}

function readFileDiskTool(workspaceRoot: string): HostToolHandler {
  return async (args) => {
    const filePath = String((args as { path?: unknown } | undefined)?.path ?? "");
    const resolved = resolveDiskPath(workspaceRoot, filePath);
    try {
      const content = await invoke<string>("read_file_disk", { path: resolved });
      return { ok: true, output: content };
    } catch (error: unknown) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  };
}

function writeFileDiskTool(workspaceRoot: string, allowedPaths: Set<string>): HostToolHandler {
  return async (args) => {
    const parsed = args as { path?: unknown; content?: unknown } | undefined;
    const filePath = String(parsed?.path ?? "");
    const content = String(parsed?.content ?? "");
    const resolved = resolveDiskPath(workspaceRoot, filePath);
    if (!allowedPaths.has(resolved)) {
      return { ok: false, error: `Only reconciled files may be modified. '${resolved}' is not in scope.` };
    }
    try {
      await invoke("write_file_disk", { path: resolved, content });
      return { ok: true, output: `Fixed: ${resolved}` };
    } catch (error: unknown) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  };
}

async function readDiskFiles(paths: string[]): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  for (const filePath of paths) {
    try {
      result[filePath] = await invoke<string>("read_file_disk", { path: filePath });
    } catch {
      // File may not exist on disk yet -- matches the sidecar's own
      // tolerant catch in its readDiskFiles.
    }
  }
  return result;
}

function fixSystemPrompt(workspaceRoot: string, filePaths: string[]): string {
  return `You are a build error fixer. A set of reconciled source files has been applied to disk and the build failed.

Your job: read the relevant files, understand the errors, and write fixed versions.

Workspace: ${workspaceRoot}
Files you may modify (reconciled files only):
${filePaths.map((f) => `- ${f}`).join("\n")}

Rules:
- Only modify files from the list above.
- Write COMPLETE file contents — never partial edits or diffs.
- Do not add comments, documentation, or unrelated changes.
- Fix exactly what the build output indicates is broken, nothing more.
- If you are not sure about a fix, make the minimal safe change.
- You may run read-only diagnostic commands (e.g. tsc --noEmit, ls, cat) to gather more information before fixing.
- Do NOT run destructive commands (rm, git reset, etc.) or install/uninstall packages.`;
}

function fixPromptText(truncatedOutput: string): string {
  return `The build failed with the following output:

\`\`\`
${truncatedOutput}
\`\`\`

Read the affected files and fix the errors so the build passes.`;
}

function assertNotAborted(signal: AbortSignal): void {
  if (signal.aborted) throw new DOMException("Aborted", "AbortError");
}

export const testBuildDefinition: CoreCapabilityDefinition<"test_build"> = {
  capability: "test_build",

  supports: (input) => mapProviderToIntegration(input.customProvider as CustomProvider, input.model).supported,

  orchestrate: async ({ input, onEvent, signal, runSession }) => {
    const mapped = mapProviderToIntegration(input.customProvider as CustomProvider, input.model);
    if (!mapped.supported) {
      throw new Error(`CoreHarness: test_build cannot run on core -- ${mapped.reason}`);
    }

    const commandParts = String(input.buildCommand || "").trim().split(/\s+/).filter(Boolean);
    if (commandParts.length === 0) throw new Error("No build command provided.");

    const rawFilePaths = Array.isArray(input.reconciledFiles)
      ? input.reconciledFiles.filter((path): path is string => typeof path === "string")
      : [];
    if (rawFilePaths.length === 0) throw new Error("No reconciled files to test.");
    const filePaths = rawFilePaths.map((path) => resolveDiskPath(input.workspaceRoot, path));
    const allowedPaths = new Set(filePaths);

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      assertNotAborted(signal);
      onEvent({ kind: "log", message: `--- Build attempt ${attempt}/${MAX_ATTEMPTS} ---` });
      onEvent({ kind: "iteration", attempt, maxAttempts: MAX_ATTEMPTS });

      const buildResult = await runShellCommand(commandParts[0], commandParts.slice(1), input.workspaceRoot, BUILD_TIMEOUT_MS);
      assertNotAborted(signal);
      if (buildResult.output.trim()) onEvent({ kind: "log", message: buildResult.output.trimEnd() });

      if (buildResult.exit_code === 0) {
        const finalFiles = await readDiskFiles(filePaths);
        onEvent({ kind: "log", message: `Build passed after ${attempt} attempt${attempt === 1 ? "" : "s"}.` });
        const result: CapabilityResult<"test_build"> = { success: true, attempts: attempt, finalFiles };
        return result;
      }

      const exitDescription = buildResult.timed_out ? "timed out" : `exit ${buildResult.exit_code ?? "null"}`;
      onEvent({ kind: "log", message: `Build failed (${exitDescription}).` });

      if (attempt === MAX_ATTEMPTS) break;

      onEvent({ kind: "log", message: "Calling model to diagnose and fix the build errors..." });
      const truncatedOutput = buildResult.output.length > MAX_BUILD_OUTPUT_CHARS
        ? `...(truncated)...\n${buildResult.output.slice(-MAX_BUILD_OUTPUT_CHARS)}`
        : buildResult.output;

      await runSession({
        recipe: {
          workspace: { root: input.workspaceRoot, binding: "disk" },
          integration: mapped.integration,
          integration_config: mapped.integration_config,
          execution_params: { model: mapped.model ?? input.model, max_tokens: 8192, reasoning_effort: mapped.reasoningEffort },
          system_prompt: fixSystemPrompt(input.workspaceRoot, filePaths),
          host_tools: [READ_FILE_TOOL, WRITE_FILE_TOOL, RUN_COMMAND_TOOL],
        },
        promptText: fixPromptText(truncatedOutput),
        hostTools: {
          read_file: readFileDiskTool(input.workspaceRoot),
          write_file: writeFileDiskTool(input.workspaceRoot, allowedPaths),
          run_command: runCommandTool(input.workspaceRoot),
        },
        onLog: (message) => onEvent({ kind: "log", message }),
      });

      onEvent({ kind: "log", message: "Model finished. Re-running build..." });
    }

    const finalFiles = await readDiskFiles(filePaths);
    onEvent({ kind: "log", message: `Build did not pass after ${MAX_ATTEMPTS} attempts.` });
    const result: CapabilityResult<"test_build"> = { success: false, attempts: MAX_ATTEMPTS, finalFiles };
    return result;
  },

  usageContext: (input) => ({ workspaceRoot: input.workspaceRoot, model: input.model }),
};
