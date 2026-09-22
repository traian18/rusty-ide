// ============================================================
// definitions/shellExec.ts — the one-shot command-execution primitive
// (src-tauri/src/shell_exec.rs's `run_shell_command`) and the ungated
// `run_command` host tool test_build builds on it. Shared here (not folded
// into exploreTools.ts, which is scoped to read/write/list/search) since
// test_build was the first capability that needed it; agent_chat's own
// permission-gated `run_command` (runCommandTool.ts) is the second
// consumer of `runShellCommand`, and deliberately NOT of `runCommandTool`.
//
// No permission gate on `runCommandTool` -- see shell_exec.rs's own doc
// comment on why: matches the sidecar's own test_build exactly (neither
// its build-command execution nor its own inline `run_command` tool went
// through commandPermissions.ts's `authorizeCommand`; that gate exists
// only for agent_chat's own `run_command` tool, a different trust
// boundary, which is what runCommandTool.ts's `gatedRunCommandTool` is).
// ============================================================

import { invoke } from "@tauri-apps/api/core";

import type { HostToolHandler } from "../CoreHarness";
import type { HostToolSpec } from "../SessionRecipe";

export interface CommandOutput {
  exit_code: number | null;
  output: string;
  timed_out: boolean;
  /** Killed via `cancel_shell_command` before it exited -- only ever true
   * for a call that passed a `signal` (below) which then aborted. */
  cancelled?: boolean;
}

/** Runs `program args...` in `cwd` and resolves once it exits, times out,
 * or -- when `signal` is given and aborts first -- is killed: the abort
 * invokes `cancel_shell_command` with the execution id this call
 * registered, so a user's Stop kills the command (and, on Unix, its
 * whole process group) instead of letting it run out its timeout. Without
 * a `signal` the call is exactly the pre-cancel shape (no execution id is
 * sent), so test_build's existing callers are unaffected. */
export function runShellCommand(program: string, args: string[], cwd: string, timeoutMs: number, signal?: AbortSignal): Promise<CommandOutput> {
  if (!signal) return invoke<CommandOutput>("run_shell_command", { program, args, cwd, timeoutMs });
  if (signal.aborted) return Promise.resolve({ exit_code: null, output: "", timed_out: false, cancelled: true });
  const executionId = crypto.randomUUID();
  const cancel = () => {
    void invoke<boolean>("cancel_shell_command", { executionId }).catch(() => {});
  };
  signal.addEventListener("abort", cancel, { once: true });
  return invoke<CommandOutput>("run_shell_command", { program, args, cwd, timeoutMs, executionId }).finally(() => {
    signal.removeEventListener("abort", cancel);
  });
}

export const RUN_COMMAND_TOOL: HostToolSpec = {
  name: "run_command",
  description: "Run a shell command in the workspace for diagnostic purposes (e.g. tsc --noEmit, ls, cat). Do not use for destructive operations or package installation.",
  input_schema: {
    type: "object",
    properties: { command: { type: "string", description: "The shell command to run (passed to sh -c)" } },
    required: ["command"],
  },
};

const CMD_TIMEOUT_MS = 60_000;
const MAX_CMD_OUTPUT_CHARS = 8_000;

/** Runs `command` via `sh -c` (matching the sidecar's own `run_command`
 * tool -- allows pipes/redirects/globs, at the cost of the model being
 * able to pass any shell syntax; see this file's header comment on the
 * trust boundary that makes that an accepted trade-off here). */
export function runCommandTool(workspaceRoot: string): HostToolHandler {
  return async (args) => {
    const command = String((args as { command?: unknown } | undefined)?.command ?? "");
    if (!command.trim()) return { ok: false, error: "run_command requires a 'command' argument." };
    try {
      const result = await runShellCommand("sh", ["-c", command], workspaceRoot, CMD_TIMEOUT_MS);
      const truncated = result.output.length > MAX_CMD_OUTPUT_CHARS
        ? `...(truncated)...\n${result.output.slice(-MAX_CMD_OUTPUT_CHARS)}`
        : result.output;
      const exitInfo = result.timed_out ? " (timed out)" : ` (exit ${result.exit_code ?? "null"})`;
      return { ok: true, output: truncated + exitInfo };
    } catch (error: unknown) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  };
}
