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
import type { AgentEventEnvelope, MutationCommand } from "@rusty/harness-sdk";

import type { SessionRecipe } from "../SessionRecipe";
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
}

/**
 * Mirrors `BridgeEvent` (src-tauri/src/harness/bridge_event.rs), whose
 * `#[serde(tag = "kind", content = "data", rename_all = "snake_case")]`
 * produces exactly this shape on the wire.
 */
export type BridgeEvent =
  | { kind: "event"; data: AgentEventEnvelope }
  | { kind: "gap"; data: { last_delivered_sequence: number | null; dropped: number } }
  | { kind: "host_tool_call"; data: { call_id: string; tool: string; input: unknown } }
  | { kind: "host_execute_call"; data: { call_id: string; tool: string; input: ExecutionRequest } }
  | { kind: "closed"; data: { reason: string } };

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

export class CoreEngineClient implements CoreEngine {
  hello(): Promise<HarnessHello> {
    return invoke("harness_hello");
  }

  async createSession(recipe: SessionRecipe): Promise<string> {
    if (recipe.execution_policy && !(await this.hello()).capabilities.includes("execution_policy")) {
      throw new Error("This harness cannot enforce skill permissions. Update the application before running this skill.");
    }
    return invoke("harness_create_session", { recipe });
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

  closeSession(sessionId: string): Promise<void> {
    return invoke("harness_close_session", { sessionId });
  }

  /**
   * Loosely typed on purpose: the full `ProviderDescriptor`/
   * `ModelDescriptor` shapes (rusty-core/crates/harness-engine/src/
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
