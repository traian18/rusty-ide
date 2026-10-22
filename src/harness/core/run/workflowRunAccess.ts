import type { AgentEventEnvelope, PermissionDecision } from "@rusty/harness-sdk";
import type { CapabilityEvent, CapabilityInput, CapabilityName, RunHost, RunOutcome, WorkflowRunOptions } from "../../contract";
import type { CoreCapabilityDefinition, RunContext } from "../CoreHarness";
import type { CoreEngine } from "../engine/CoreEngineClient";
import type { ToolPermissionRequest } from "./hostCalls";

/** The workflow a definition runs on the session instead of prompting it. */
export interface WorkflowSpec {
  definition: unknown;
  input: unknown;
  checkpoint?: unknown;
  options?: WorkflowRunOptions;
}

/** What a workflow needs from the run it belongs to. */
export interface WorkflowRunAccess<K extends CapabilityName> {
  readonly runId: string;
  readonly engine: CoreEngine;
  readonly definition: CoreCapabilityDefinition<K>;
  readonly input: CapabilityInput<K>;
  readonly host: RunHost;
  readonly context: RunContext;
  readonly signal: AbortSignal;
  readonly onEvent: (event: CapabilityEvent<K>) => void;
  sessionId(): string | undefined;
  isSettled(): boolean;
  /** Neither settled nor aborted. */
  isLive(): boolean;
  settle(outcome: RunOutcome<K>): void;
  log(message: string): void;
  onAgentEvent(envelope: AgentEventEnvelope): void;
  /** `resolve` sends the decision somewhere other than the session itself. */
  requestPermission(request: ToolPermissionRequest, resolve?: (decision: PermissionDecision) => Promise<void> | undefined): void;
}

export function nodeIdOf(event: { [key: string]: unknown }): string {
  return typeof event.node_id === "string" ? event.node_id : "";
}
