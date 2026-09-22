// ============================================================
// ExecutionProtocol.ts — TypeScript mirror of rusty-core's
// `ExecutionRequest`/`ExecutionEvent`/`ExecutionResult`/`ExecutionError`
// (rusty-core/crates/harness-protocol/src/backend.rs), the wire contract
// crossing the new host-execution bridge (`BridgeEvent::HostExecuteCall` /
// `harness_host_execute_event` / `harness_host_execute_result`).
//
// Hand-mirrored the same way `SessionRecipe.ts` already mirrors
// `ExecutionParams` -- these aren't in `@rusty/harness-sdk` yet (upstream
// ask U4); replace with a real SDK import once that lands.
// ============================================================

import type { ExecutionParams } from "../SessionRecipe";

export interface AgentMessage {
  // Deliberately loose: rusty-core's `AgentMessage` (harness-protocol/src/
  // messages.rs) isn't consumed structurally anywhere on this side of the
  // bridge yet -- `ExecutionRequest.messages` is built and read entirely by
  // whatever answers a `host_execute_call` (Phase 1: the sidecar), which
  // has its own message representation to translate to/from. Widen this to
  // a real mirror if a TS-side reader of `messages` shows up.
  [key: string]: unknown;
}

export interface ToolDescriptor {
  id: string;
  name: string;
  description: string;
  input_schema: unknown;
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: unknown;
}

export interface ExecutionRequest {
  request_id: string;
  run_id: string;
  system_prompt: string;
  messages: AgentMessage[];
  tools: ToolDescriptor[];
  extended_thinking: boolean;
  params: ExecutionParams;
}

export interface ModelUsage {
  input_tokens: number | null;
  output_tokens: number | null;
  cache_read_tokens: number | null;
  cache_write_tokens: number | null;
  reasoning_tokens: number | null;
  total_tokens: number | null;
}

export interface Cost {
  amount_usd: string | null;
  source: "ProviderReported" | "Calculated" | "Estimated" | null;
}

export interface ExecutionResult {
  request_id: string;
  usage: ModelUsage;
  cost: Cost;
  finish_reason: string;
}

export type ExecutionError =
  | { BackendError: { message: string; code: string } }
  | { RateLimited: { retry_after: number | null } }
  | { InvalidRequest: { message: string } }
  | "Cancelled"
  | "Timeout"
  | { UnsupportedCapability: { capability: string; detail: string } };

/** Narrows a caught value to an already-well-formed `ExecutionError` --
 * e.g. what `SidecarExecutionAnswerer.execute()` rejects with when the
 * sidecar's own `backend_execute_error` message already carries one
 * (`agent-sidecar/src/capabilities/backendExecute.ts` constructs its
 * `error` field as exactly this shape). `CoreHarness.ts`'s
 * `handleHostExecuteCall` uses this to pass such a rejection straight
 * through to `hostExecuteResult` instead of re-wrapping it into a generic
 * `BackendError{message: String(error), ...}` -- which, for a plain
 * object, stringifies to the useless `"[object Object]"` and discards the
 * real message underneath (the bug this guard fixes). */
export function isExecutionError(value: unknown): value is ExecutionError {
  if (value === "Cancelled" || value === "Timeout") return true;
  if (typeof value !== "object" || value === null) return false;
  return "BackendError" in value || "RateLimited" in value || "InvalidRequest" in value || "UnsupportedCapability" in value;
}

export type ExecutionEvent =
  | { TextDelta: { request_id: string; delta: string } }
  | { ReasoningDelta: { request_id: string; delta: string } }
  | { ToolCallRequested: { request_id: string; call: ToolCall } }
  | { UsageUpdate: { request_id: string; usage: ModelUsage } }
  | { Completed: { request_id: string; result: ExecutionResult } }
  | { Error: { request_id: string; error: ExecutionError } };
