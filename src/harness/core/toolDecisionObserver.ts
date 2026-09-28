import type { AgentEventEnvelope } from "@rusty/harness-sdk";
import type { CapabilityName } from "../contract";

/** What a session was asked to do, so an observer can judge its tool calls
 * against the request rather than in isolation. */
export interface ToolDecisionSessionContext {
  capability: CapabilityName;
  /** The prompt the session was started with. */
  prompt: string;
  /** The model the session runs on, when the recipe names one. */
  model?: string;
}

/**
 * Watches every session's agent events, whatever model runs it, to judge the
 * decisions the model makes (today: each tool call it requests). Installed
 * process-wide by the app; the harness only forwards events and never waits
 * on it, so an observer cannot change or delay a run.
 */
export interface ToolDecisionObserver {
  beginSession(runId: string, sessionId: string, context: ToolDecisionSessionContext): void;
  observe(runId: string, envelope: AgentEventEnvelope): void;
  endRun(runId: string): void;
  /** What the agent making this tool call did before it, as plain text for
   * a decision model; `undefined` when the observer has no record of it. */
  describeHistoryBefore?(runId: string, sessionId: string, toolCallId: string): string | undefined;
  /** Reports each tool call the same agent finishes after this one, until
   * `listener` returns false or the run ends. */
  watchFollowUp?(runId: string, sessionId: string, toolCallId: string, listener: (call: FollowUpCall) => boolean): void;
}

/** A tool call an agent finished after the call being followed up. */
export interface FollowUpCall {
  callId: string;
  tool: string;
  failed: boolean;
}

let installed: ToolDecisionObserver | undefined;

export function setToolDecisionObserver(observer: ToolDecisionObserver | undefined): void {
  installed = observer;
}

export function toolDecisionObserver(): ToolDecisionObserver | undefined {
  return installed;
}
