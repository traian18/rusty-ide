// Answers the calls a rusty-core session makes back into the IDE -- host
// tools, model turns, permission prompts -- the same way for a capability's
// run and for an orchestrating definition's single-shot sessions.

import type { PermissionDecision, PermissionRequest } from "@rusty/harness-sdk";
import type { CommandPermissionDecision, CommandPermissionRequest, RunHost } from "../../contract";
import type { CoreEngine, HostToolOutcome } from "../engine/CoreEngineClient";
import type { ExecutionEvent, ExecutionRequest, ExecutionResult } from "../engine/ExecutionProtocol";
import { errorMessage, ignoreFailure, toExecutionError } from "./failures";

export interface HostToolCallData {
  call_id: string;
  tool: string;
  input: unknown;
  tool_call_id?: string;
  session_id?: string;
}

export interface HostExecuteCallData {
  call_id: string;
  tool: string;
  input: ExecutionRequest;
}

/** Sends a host tool's outcome, or its failure, back to the session. */
export function deliverToolOutcome(engine: CoreEngine, sessionId: string, callId: string, outcome: Promise<HostToolOutcome>): void {
  outcome
    .then((result) => engine.hostToolResult(sessionId, callId, result))
    .catch((error: unknown) => engine.hostToolResult(sessionId, callId, { ok: false, error: errorMessage(error) }))
    .catch(ignoreFailure(`answering host tool call ${callId}`));
}

/** Answers the two Workspace-trait tools every session handles the same way
 * regardless of capability; false for any other tool. */
export function answerWorkspaceTool(engine: CoreEngine, host: RunHost, sessionId: string, data: HostToolCallData, signal: AbortSignal): boolean {
  if (data.tool === "workspace.read") {
    const path = String((data.input as { path?: unknown } | undefined)?.path ?? "");
    deliverToolOutcome(engine, sessionId, data.call_id, host.readFile(path, signal).then((content): HostToolOutcome => ({ ok: true, output: { content } })));
    return true;
  }
  if (data.tool === "workspace.write") {
    const input = data.input as { path?: unknown; content?: unknown } | undefined;
    const write = host.writeFile(String(input?.path ?? ""), String(input?.content ?? ""), signal);
    deliverToolOutcome(engine, sessionId, data.call_id, write.then((): HostToolOutcome => ({ ok: true, output: {} })));
    return true;
  }
  return false;
}

/** Registered on the recipe but nothing answers it (a misconfigured
 * definition) -- fail it so the model sees an error rather than hanging on
 * an unanswered call. */
export function failUnhandledTool(engine: CoreEngine, sessionId: string, data: HostToolCallData): void {
  void engine
    .hostToolResult(sessionId, data.call_id, { ok: false, error: `CoreHarness: no handler for host tool "${data.tool}".` })
    .catch(ignoreFailure(`failing unhandled host tool ${data.tool}`));
}

/** Streams one model turn back to the session: every event, then the result.
 *
 * Every event and the terminal result are separate Tauri invokes, and Tauri
 * makes no ordering guarantee between independent invokes -- so they are
 * chained here to run strictly one after another. The Rust side
 * (`HostBridge::finish_stream`) removes the pending stream when the result
 * lands, after which `push_event` silently drops any event for that call_id.
 * Without this chain, a result invoke that overtakes the preceding
 * `ToolCallRequested` event loses the tool call entirely: rusty-core sees
 * `finish_reason: "tool_use"` with no tool call to dispatch and the run
 * stalls forever -- which is exactly what happened to every tool-calling
 * turn on execute_node (no-tool capabilities never hit it, since they have
 * no event that must precede the result).
 *
 * `turn` starts the model turn with the event sink to stream into; it is
 * called synchronously. `onResult` sees a successful result before it is sent. */
export function answerExecuteCall(
  engine: CoreEngine,
  sessionId: string,
  callId: string,
  turn: (onEvent: (event: ExecutionEvent) => void) => Promise<ExecutionResult>,
  onResult?: (result: ExecutionResult) => void,
): void {
  let delivery: Promise<void> = Promise.resolve();
  const enqueue = (send: () => Promise<void>) => {
    delivery = delivery.then(send).catch(ignoreFailure(`streaming model turn ${callId}`));
    return delivery;
  };
  turn((event) => {
    void enqueue(() => engine.hostExecuteEvent(sessionId, callId, event));
  })
    .then(
      (result) => {
        onResult?.(result);
        return enqueue(() => engine.hostExecuteResult(sessionId, callId, { ok: true, result }));
      },
      (error: unknown) => enqueue(() => engine.hostExecuteResult(sessionId, callId, { ok: false, error: toExecutionError(error) })),
    )
    .catch(ignoreFailure(`answering model turn ${callId}`));
}

type ToolPermissionRequest = Pick<PermissionRequest, "id" | "tool_call">;

/** The prompt the host shows for a core `PermissionRequested`.
 *
 * A core ToolCall has no shell-shaped command today -- best effort until
 * Milestone C registers a real shell.exec tool (HARNESS_CONTRACT_PLAN.md's
 * Milestone C table) with an actual program/args/cwd to report here. Dead
 * code for every registered host_tool so far (global_explore's read/
 * list_files/search_codebase are all PermissionMode::Allow, so no
 * PermissionRequested ever fires for them), kept so a later tool needing
 * PermissionMode::Ask doesn't have to add this wiring itself. */
export function permissionPrompt(request: ToolPermissionRequest, sessionId: string): CommandPermissionRequest {
  const args = request.tool_call.arguments;
  return {
    requestId: request.id,
    sessionId,
    command: {
      program: request.tool_call.name,
      args: Array.isArray(args) ? args.map(String) : [],
      cwd: "",
      timeoutMs: 0,
    },
    risk: "normal",
    sessionGrantScope: "exact_command",
    sessionGrantProgram: request.tool_call.name,
    description: `Allow "${request.tool_call.name}"?`,
  };
}

export function permissionDecision(decision: CommandPermissionDecision): PermissionDecision {
  return decision === "deny" ? "Denied" : "Approved";
}

export type { ToolPermissionRequest };
