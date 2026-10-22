// Routing a session's events to their handlers, and the progress lines a
// run logs for them.

import type { AgentEvent, AgentEventEnvelope, ToolResultSummary } from "@rusty/harness-sdk";
import type { BridgeEvent } from "../engine/CoreEngineClient";

type VariantOf<E> = E extends unknown ? keyof E : never;
export type AgentEventKind = VariantOf<AgentEvent>;
type PayloadOf<Kind extends AgentEventKind> = Extract<AgentEvent, Record<Kind, unknown>>[Kind];

/** A handler per agent event variant; a variant without one is ignored. */
export type AgentEventHandlers = {
  [Kind in AgentEventKind]?: (payload: PayloadOf<Kind>, envelope: AgentEventEnvelope) => void;
};

export function dispatchAgentEvent(handlers: AgentEventHandlers, envelope: AgentEventEnvelope): void {
  const event = envelope.event as AgentEvent;
  const kind = Object.keys(event)[0] as AgentEventKind;
  const handler = handlers[kind] as ((payload: unknown, envelope: AgentEventEnvelope) => void) | undefined;
  handler?.((event as Record<string, unknown>)[kind], envelope);
}

/** A handler per bridge event kind. */
export type BridgeEventHandlers = {
  [Kind in BridgeEvent["kind"]]: (data: Extract<BridgeEvent, { kind: Kind }>["data"]) => void;
};

export function dispatchBridgeEvent(handlers: Partial<BridgeEventHandlers>, event: BridgeEvent): void {
  const handler = handlers[event.kind] as ((data: unknown) => void) | undefined;
  handler?.(event.data);
}

const CHILD_OWNED: AgentEventKind[] = ["Completed", "Failed", "AssistantTextDelta"];

/** A subagent's terminal events and text belong to the subagent: they must
 * not settle the parent's task or count as its final response. They remain
 * in the trace. */
export function isChildOwnedEvent(envelope: AgentEventEnvelope): boolean {
  if (!envelope.parent_agent_id) return false;
  return CHILD_OWNED.some((kind) => kind in (envelope.event as object));
}

/** `: <command or path>` for a tool call's log line, or "" when it names neither. */
export function toolCallDetail(args: unknown): string {
  if (!args || typeof args !== "object") return "";
  const record = args as Record<string, unknown>;
  const cmd = record.command ?? record.cmd ?? record.program;
  if (typeof cmd === "string" && cmd.trim()) return `: ${cmd.trim().slice(0, 60)}`;
  const path = record.path ?? record.filename ?? record.file_path;
  if (typeof path === "string" && path.trim()) return `: ${path.trim().slice(0, 60)}`;
  return "";
}

export function toolCompletedMessage(result: ToolResultSummary): string {
  if (!result.has_error) return "Tool call completed.";
  const preview = result.output_preview ? result.output_preview.trim().slice(0, 80) : "";
  return `Tool call failed${preview ? `: ${preview}` : "."}`;
}

export function completionGateMessage(gate: PayloadOf<"CompletionGateEvaluated">): string {
  const checks = gate.failed_checks.join(", ");
  if (gate.passed) {
    return checks ? `Completion gate passed; out of attempts, so these were waived: ${checks}.` : "Completion gate passed.";
  }
  return gate.continuing
    ? `Completion gate rejected the answer (${checks}); the agent continues.`
    : `Completion gate not passed (${checks}).`;
}

/** Behavior layer: what the active profile did, so its effect is visible in
 * the run's progress log. */
export const BEHAVIOR_LOGS = {
  ProfileChanged: (change: PayloadOf<"ProfileChanged">) => `Behavior profile: ${change.from} → ${change.to}`,
  BehaviorRuleFired: (fired: PayloadOf<"BehaviorRuleFired">) => `Rule ${fired.rule_id} (${fired.event}): ${fired.action}`,
  ToolCallDenied: (denied: PayloadOf<"ToolCallDenied">) => `Denied by behavior profile: ${denied.reason}`,
  CompletionGateEvaluated: completionGateMessage,
};
