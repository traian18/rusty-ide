// ============================================================
// CoreEngineClient.ts — Thin TypeScript client over the Tauri commands
// registered in src-tauri/src/harness/commands.rs (HARNESS_CONTRACT_PLAN.md
// Milestone B2). One method per command, same names with the `harness_`
// prefix dropped, so a mismatch between the two is easy to spot by grep.
// Nothing here knows about capabilities, tabs, or the VFS -- CoreHarness
// (Milestone B4) is the layer that turns a capability run into calls on
// this client.
//
// `import type` only from `@rusty/harness-sdk` -- the SDK's *runtime* code
// (client.ts/transport.ts) imports `node:crypto`/`node:child_process` and
// is not browser-safe yet (upstream ask U4); a type-only import is erased
// at compile time, so it never reaches the Vite bundle. This class is its
// own runtime, written over `invoke`/`Channel` -- not the SDK's own
// `HarnessClient`, which has a private constructor, a fixed `createSession`
// payload, and no slot for host-tool calls (HARNESS_CONTRACT_PLAN.md
// decision 2).
// ============================================================

import { Channel, invoke } from "@tauri-apps/api/core";
import type { AgentEventEnvelope, MutationCommand, PermissionDecision } from "@rusty/harness-sdk";
import type { WorkflowEventEnvelope } from "../workflowRun";

import type { ExecutionParams, SessionRecipe } from "../SessionRecipe";
import { logExecutionDiagnostic } from "../executionDiagnostics";
import type { ExecutionEvent, ExecutionResult, ExecutionError, ExecutionRequest } from "./ExecutionProtocol";

/**
 * The subset of `CoreEngineClient`'s methods `CoreHarness.ts` (Milestone B4)
 * actually calls, factored out so its tests can drive a scriptable fake
 * instead of the real Tauri `invoke`/`Channel` runtime -- mirrors why
 * `SidecarHarness.ts` depends on the `AgentHarnessClient` *type* rather than
 * constructing its own client, just satisfied structurally here instead of
 * via a shared base class. `CoreEngineClient` implements this plus `hello`/
 * `snapshot`/`listProviders`/`listModels`, none of which a capability run
 * itself needs.
 */
export interface CoreEngine {
  createSession(recipe: SessionRecipe): Promise<string>;
  subscribe(sessionId: string, onEvent: (event: BridgeEvent) => void): Promise<void>;
  mutate(sessionId: string, command: MutationCommand): Promise<void>;
  hostToolResult(sessionId: string, callId: string, outcome: HostToolOutcome): Promise<void>;
  hostExecuteEvent(sessionId: string, callId: string, event: ExecutionEvent): Promise<void>;
  hostExecuteResult(sessionId: string, callId: string, outcome: HostExecuteOutcome): Promise<void>;
  closeSession(sessionId: string): Promise<void>;
  /** Starts the workflow the session's recipe carries; resolves to the run id. */
  startWorkflow?(sessionId: string, input: unknown, checkpoint?: unknown): Promise<string>;
  workflowControl?(sessionId: string, control: WorkflowControl): Promise<void>;
  /** Changes a running workflow step's execution params (its model). */
  configureStepExecution?(sessionId: string, stepSessionId: string, params: ExecutionParams): Promise<void>;
}

/** Mirrors `WorkflowControl` in src-tauri/src/harness/workflow.rs. */
export type WorkflowControl =
  | { type: "cancel" }
  | { type: "pause" }
  | { type: "resume" }
  | { type: "resolve_permission"; id: string; decision: PermissionDecision };

/**
 * Mirrors `BridgeEvent` (src-tauri/src/harness/bridge_event.rs), whose
 * `#[serde(tag = "kind", content = "data", rename_all = "snake_case")]`
 * produces exactly this shape on the wire.
 */
export type BridgeEvent =
  | { kind: "event"; data: AgentEventEnvelope }
  | { kind: "gap"; data: { last_delivered_sequence: number | null; dropped: number } }
  | {
      kind: "host_tool_call";
      /** `session_id`: the session whose agent asked -- this one, or a
       * workflow step's session sharing its tools. Answers always go to the
       * subscribed session. */
      data: { call_id: string; tool: string; input: unknown; tool_call_id?: string; session_id?: string };
    }
  | { kind: "host_execute_call"; data: { call_id: string; tool: string; input: ExecutionRequest } }
  | { kind: "closed"; data: { reason: string } }
  | { kind: "workflow_event"; data: WorkflowEventEnvelope }
  | { kind: "workflow_agent_event"; data: { node_id: string; attempt: number; envelope: AgentEventEnvelope } }
  | { kind: "workflow_finished"; data: { state: unknown } };

export interface HarnessHello {
  protocol_version: number;
  capabilities: string[];
}

/** Mirrors `SessionSnapshotWire` in src-tauri/src/harness/session.rs -- a
 * deliberately minimal wire type, distinct from the SDK's own
 * `SessionSnapshotWire` (an untyped `Record<string, unknown>` mirroring the
 * RPC daemon's richer snapshot). */
export interface SessionSnapshot {
  session_id: string;
  status: string;
}

export type HostToolOutcome = { ok: true; output: unknown } | { ok: false; error: unknown };

export type HostExecuteOutcome = { ok: true; result: ExecutionResult } | { ok: false; error: ExecutionError };

const sessionWorkspaceRoots = new Map<string, string>();

function truncateForLog(value: unknown, maxChars = 2_000): unknown {
  if (typeof value === "string") return value.length > maxChars ? `${value.slice(0, maxChars)}… [truncated ${value.length - maxChars} chars]` : value;
  if (value === null || typeof value !== "object") return value;
  try {
    const json = JSON.stringify(value);
    return json.length > maxChars ? `${json.slice(0, maxChars)}… [truncated ${json.length - maxChars} chars]` : value;
  } catch {
    return String(value);
  }
}

function logHarnessBridgeFailure(sessionId: string, message: string, details: Record<string, unknown>): void {
  const sanitized = Object.fromEntries(Object.entries(details).map(([key, value]) => [key, truncateForLog(value)]));
  logExecutionDiagnostic(sessionWorkspaceRoots.get(sessionId), "warn", "CoreHarness", message, sanitized);
}

export class CoreEngineClient implements CoreEngine {
  hello(): Promise<HarnessHello> {
    return invoke("harness_hello");
  }

  async createSession(recipe: SessionRecipe): Promise<string> {
    if (recipe.execution_policy && !(await this.hello()).capabilities.includes("execution_policy")) {
      throw new Error("This harness cannot enforce skill permissions. Update the application before running this skill.");
    }
    const sessionId = await invoke<string>("harness_create_session", { recipe });
    sessionWorkspaceRoots.set(sessionId, recipe.workspace.root);
    return sessionId;
  }

  /**
   * Subscribes to a session's buffered events, delivering each `BridgeEvent`
   * to `onEvent` in order. Can only be called once per session --
   * `harness_subscribe` errors on a second call (the bridge's own
   * one-subscriber-per-session inbox, mirroring the contract's
   * one-subscriber-per-run expectation). There is no unsubscribe: the
   * stream ends on its own with a `{kind: "closed"}` event, or by calling
   * `closeSession`.
   */
  subscribe(sessionId: string, onEvent: (event: BridgeEvent) => void): Promise<void> {
    const channel = new Channel<BridgeEvent>(onEvent);
    return invoke("harness_subscribe", { sessionId, onEvent: channel });
  }

  mutate(sessionId: string, command: MutationCommand): Promise<void> {
    return invoke("harness_mutate", { sessionId, command });
  }

  /** Delivers the IDE's answer for a previously issued `{kind:
   * "host_tool_call"}` event. */
  hostToolResult(sessionId: string, callId: string, outcome: HostToolOutcome): Promise<void> {
    if (!outcome.ok) {
      logHarnessBridgeFailure(sessionId, "host tool returned an error", { sessionId, callId, error: outcome.error });
    }
    return invoke("harness_host_tool_result", {
      sessionId,
      callId,
      ok: outcome.ok,
      output: outcome.ok ? outcome.output : outcome.error,
    });
  }

  /** Delivers one interim event for a still-open `{kind: "host_execute_call"}`
   * -- the streaming counterpart to `hostToolResult`, since a model turn
   * emits incremental events before its final result. */
  hostExecuteEvent(sessionId: string, callId: string, event: ExecutionEvent): Promise<void> {
    return invoke("harness_host_execute_event", { sessionId, callId, event });
  }

  /** Delivers the terminal result for a `{kind: "host_execute_call"}`. */
  hostExecuteResult(sessionId: string, callId: string, outcome: HostExecuteOutcome): Promise<void> {
    if (!outcome.ok) {
      logHarnessBridgeFailure(sessionId, "host model execution returned an error", { sessionId, callId, error: outcome.error });
    }
    return invoke("harness_host_execute_result", {
      sessionId,
      callId,
      ok: outcome.ok,
      result: outcome.ok ? outcome.result : undefined,
      error: outcome.ok ? undefined : outcome.error,
    });
  }

  snapshot(sessionId: string): Promise<SessionSnapshot> {
    return invoke("harness_snapshot", { sessionId });
  }

  startWorkflow(sessionId: string, input: unknown, checkpoint?: unknown): Promise<string> {
    return invoke("harness_start_workflow", { sessionId, input, checkpoint });
  }

  workflowControl(sessionId: string, control: WorkflowControl): Promise<void> {
    return invoke("harness_workflow_control", { sessionId, control });
  }

  configureStepExecution(sessionId: string, stepSessionId: string, params: ExecutionParams): Promise<void> {
    return invoke("harness_configure_step_execution", { sessionId, stepSessionId, params });
  }

  closeSession(sessionId: string): Promise<void> {
    sessionWorkspaceRoots.delete(sessionId);
    return invoke("harness_close_session", { sessionId });
  }

  /**
   * Loosely typed on purpose: the full `ProviderDescriptor`/`ModelDescriptor`
   * shapes (rusty-core/crates/harness-engine/src/
   * providers.rs) pull in `ProviderKey`/`AdapterKind`/`AuthMethod`, none of
   * which any capability needs yet (they're Milestone C's provider-picker
   * concern) -- hand-mirroring them now would have no consumer to keep
   * honest.
   */
  listProviders(): Promise<unknown[]> {
    return invoke("harness_list_providers");
  }

  listModels(provider: string, refresh: boolean): Promise<unknown[]> {
    return invoke("harness_list_models", { provider, refresh });
  }
}
