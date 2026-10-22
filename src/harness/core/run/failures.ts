// How a core run treats failures that must not end it: observability that
// fails open, and best-effort sends to a session that may already be gone.

import { isExecutionError, type ExecutionError } from "../engine/ExecutionProtocol";

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Observability is deliberately fail-open: recording a run is useful, but
 * it must never become part of the provider's execution contract. Browser
 * storage, payload sanitization, or a UI subscriber can all fail independently
 * of rusty-core, and none of those failures may stop a Claude/Codex/Copilot
 * session from starting or consuming its events. */
export function observe(action: () => void): void {
  try {
    action();
  } catch (error) {
    console.warn("Execution observability failed without affecting the run:", error);
  }
}

/** Records a failure the run deliberately carries on past -- a reply to a
 * session that has already closed, a cleanup after the run settled -- so it
 * stays visible when debugging without reaching the user. */
export function reportIgnored(what: string, error: unknown): void {
  console.debug(`CoreHarness: ${what} failed; the run carries on.`, error);
}

/** `reportIgnored` as a `.catch` handler. */
export function ignoreFailure(what: string): (error: unknown) => void {
  return (error) => reportIgnored(what, error);
}

export function toExecutionError(error: unknown): ExecutionError {
  // A rejection from a real ExecutionAnswerer (SidecarExecutionAnswerer's
  // own catch blocks, both the sidecar-reported-error path and its
  // connection-failure fallback) is already a well-formed ExecutionError --
  // pass it straight through rather than re-wrapping it, which would
  // stringify an object via errorMessage() into the useless
  // "[object Object]" and discard the real message underneath. Only a
  // genuinely unexpected rejection (a thrown DOMException on abort, or
  // anything not shaped like ExecutionError) falls through to the generic
  // wrapper below.
  if (isExecutionError(error)) return error;
  return { BackendError: { message: errorMessage(error), code: "HOST_EXECUTE_ANSWERER_FAILED" } };
}
