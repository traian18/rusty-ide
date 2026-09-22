// ============================================================
// definitions/runCommandTool.ts — agent_chat's permission-gated
// `run_command` host tool: the model asks for a structured
// {program, args, cwd, timeoutMs}, the IDE asks the user through the
// command-permission dialog (RunHost.requestPermission ->
// commandPermissionService, with its per-session grant memory), and only
// an approved command reaches shell_exec.rs's `run_shell_command`.
//
// Ported from the removed sidecar's capabilities/tools/runCommandTool.ts +
// services/commandExecution.ts's `normalizeCommand`, closing the "No
// run_command (shell.exec)" v1 scope cut in agent_chat.ts. The one
// deliberate difference from test_build's ungated `runCommandTool`
// (shellExec.ts): this takes separate program/args -- NOT a `sh -c`
// string -- because everything the gate does depends on seeing the real
// argv: risk is classified per operation (harness/commandPolicy.ts), and a
// normal-risk direct program earns an executable-level session grant so
// approving `grep` once covers the next `grep`. Wrapping in `sh -c` would
// make every command an interpreter call: always exact-grant, never
// classifiable.
//
// Trust boundary: the user decides per command (or per pattern, for the
// session) in the dialog, which shows the exact argv and cwd that will
// run. Two accepted limits, both inherited from the sidecar's shape:
//  - `cwd` containment is checked lexically (`..` collapsed, must stay
//    under the workspace root) rather than via realpath -- the IDE has no
//    canonicalize primitive, and the dialog shows the cwd it resolved to.
//  - The command runs with the IDE process's own environment, so it can
//    use whatever local/cloud credentials that environment holds; the
//    dialog says so.
// ============================================================

import type { CapabilityEvent, RunHost } from "../../contract";
import type { NormalizedCommand } from "../../commandPolicy";
import { classifyCommandRisk, commandSessionGrantScope, programName, resolvePath } from "../../commandPolicy";
import type { HostToolHandler } from "../CoreHarness";
import type { HostToolSpec } from "../SessionRecipe";
import { runShellCommand } from "./shellExec";

export const GATED_RUN_COMMAND_TOOL: HostToolSpec = {
  name: "run_command",
  description: "Last-resort tool for an essential build, test, typecheck, lint, generator, or explicitly requested executable after user approval. Use Rusty's read_file, write_file, list_files, and search_codebase tools for workspace operations; never use this tool to inspect, search, create, edit, move, or delete files. Use separate program and args fields; do not wrap commands in sh or bash.",
  input_schema: {
    type: "object",
    properties: {
      program: { type: "string", description: "Executable name, for example terragrunt, npm, or git." },
      args: { type: "array", items: { type: "string" }, description: "Arguments passed literally to the executable." },
      cwd: { type: "string", description: "Workspace-relative working directory. Defaults to the workspace root." },
      timeoutMs: { type: "number", description: "Timeout in milliseconds, between 1 second and 30 minutes." },
    },
    required: ["program"],
  },
};

export const DEFAULT_TIMEOUT_MS = 5 * 60_000;
export const MAX_TIMEOUT_MS = 30 * 60_000;
const MIN_TIMEOUT_MS = 1_000;
const MAX_ARGS = 256;
const MAX_ARG_CHARS = 16_384;
/** Tail of the combined output handed back to the model; the full text
 * (bounded by the UI's own console buffer) still goes to the console via
 * the `command_output` event. */
export const MAX_TOOL_OUTPUT_CHARS = 32_000;

/** Validates the model's raw tool input into the exact command that will
 * be shown in the dialog and executed. Throws on anything malformed. */
export function normalizeCommand(input: unknown, workspaceRoot: string): NormalizedCommand {
  const raw = (input && typeof input === "object" ? input : {}) as { program?: unknown; args?: unknown; cwd?: unknown; timeoutMs?: unknown };
  const program = String(raw.program ?? "").trim();
  if (!program || program.includes("\0")) throw new Error("A valid command program is required.");
  const args: string[] = Array.isArray(raw.args) ? raw.args.map((arg) => String(arg)) : [];
  if (args[0] === program || args[0] === programName({ program })) {
    // Models occasionally repeat the structured `program` as argv[0],
    // producing commands such as `ls ls -la` and `grep grep -r`. Normalize
    // before asking for permission so the dialog always shows the command
    // that will execute.
    args.shift();
  }
  if (args.length > MAX_ARGS || args.some((arg) => arg.length > MAX_ARG_CHARS || arg.includes("\0"))) {
    throw new Error("Command arguments exceed the allowed limits.");
  }

  const root = workspaceRoot.trim();
  if (!root) throw new Error("No workspace root is available for command execution.");
  const canonicalRoot = resolvePath(root, ".");
  const requestedCwd = String(raw.cwd ?? ".").trim() || ".";
  const cwd = resolvePath(canonicalRoot, requestedCwd);
  const sep = canonicalRoot.includes("\\") ? "\\" : "/";
  if (cwd !== canonicalRoot && !cwd.startsWith(canonicalRoot.endsWith(sep) ? canonicalRoot : `${canonicalRoot}${sep}`)) {
    throw new Error("Command working directory must remain inside the workspace.");
  }

  const requestedTimeout = Number(raw.timeoutMs) || DEFAULT_TIMEOUT_MS;
  return { program, args, cwd, timeoutMs: Math.max(MIN_TIMEOUT_MS, Math.min(requestedTimeout, MAX_TIMEOUT_MS)) };
}

export function formatCommand(command: NormalizedCommand): string {
  return [command.program, ...command.args].join(" ");
}

export interface GatedRunCommandOptions {
  workspaceRoot: string;
  /** The grant-memory session: agent_chat passes its `tabId`, so an "allow
   * this session" answer outlives the single rusty-core session behind one
   * turn and covers the whole conversation in that tab, matching the
   * sidecar's own per-tab Pi session. */
  sessionId: string;
  host: RunHost;
  onEvent: (event: CapabilityEvent<"agent_chat">) => void;
}

function describeExit(result: { exit_code: number | null; timed_out: boolean; cancelled?: boolean }): string {
  if (result.cancelled) return "cancelled";
  if (result.timed_out) return "timed out";
  return result.exit_code === null ? "exited with no status" : `exited with code ${result.exit_code}`;
}

export function gatedRunCommandTool(options: GatedRunCommandOptions): HostToolHandler {
  const { workspaceRoot, sessionId, host, onEvent } = options;
  return async (args, signal) => {
    let command: NormalizedCommand;
    try {
      command = normalizeCommand(args, workspaceRoot);
    } catch (error: unknown) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }

    const risk = classifyCommandRisk(command);
    const sessionGrantScope = commandSessionGrantScope(command, risk);
    let decision: Awaited<ReturnType<RunHost["requestPermission"]>>;
    try {
      decision = await host.requestPermission(
        {
          requestId: crypto.randomUUID(),
          sessionId,
          command,
          risk,
          sessionGrantScope,
          sessionGrantProgram: programName(command),
          description: `The agent wants to run: ${formatCommand(command)}`,
        },
        signal,
      );
    } catch (error: unknown) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
    if (decision === "deny") return { ok: false, error: "Command denied by the user." };
    if (decision !== "allow_once" && decision !== "allow_session") {
      return { ok: false, error: "Command permission response was invalid." };
    }

    onEvent({ kind: "log", message: `Running approved command: ${formatCommand(command)}` });
    try {
      const result = await runShellCommand(command.program, command.args, command.cwd, command.timeoutMs, signal);
      if (result.output) onEvent({ kind: "command_output", content: result.output });
      onEvent({ kind: "command_complete" });
      const status = describeExit(result);
      onEvent({ kind: "log", message: `Command ${status}.` });
      const truncated = result.output.length > MAX_TOOL_OUTPUT_CHARS
        ? `...(truncated)...\n${result.output.slice(-MAX_TOOL_OUTPUT_CHARS)}`
        : result.output;
      return { ok: true, output: `${truncated}${truncated && !truncated.endsWith("\n") ? "\n" : ""}(command ${status})` };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      onEvent({ kind: "log", message: `Command failed to start: ${message}` });
      return { ok: false, error: message };
    }
  };
}
