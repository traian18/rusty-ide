// What a tool call's record goes through: created queued when the call is
// requested (or when a later event arrives first), changed by each lifecycle
// event, and closed when its run ends or a load finds it still active.

import type { AgentEvent, AgentEventEnvelope, PermissionRequest, ToolResultSummary } from "@rusty/harness-sdk";
import type { CapabilityName, RunOutcome } from "../harness/contract";
import { sanitizeForObservability } from "./redaction";
import { requestingModel, runTokensSnapshot, type RunContext } from "./runContext";
import type { ExecutionTokensSnapshot, ToolExecutionRecord } from "./types";

export const ACTIVE_STATUSES = new Set<ToolExecutionRecord["status"]>(["queued", "waiting-permission", "running"]);

export function iso(value?: string): string {
  return value || new Date().toISOString();
}

function duration(record: ToolExecutionRecord, finishedAt: string): number | undefined {
  const start = record.startedAt ?? record.requestedAt;
  const millis = Date.parse(finishedAt) - Date.parse(start);
  return Number.isFinite(millis) && millis >= 0 ? millis : undefined;
}

export function toolCallRecordId(sessionId: string | undefined, callId: string): string {
  return `${sessionId}:${callId}`;
}

/** Where in the run an event came from, kept on every record it touches. */
export function envelopeMetadata(envelope: AgentEventEnvelope) {
  return {
    sessionId: envelope.session_id,
    coreRunId: envelope.run_id ?? undefined,
    agentId: envelope.agent_id,
    parentAgentId: envelope.parent_agent_id ?? undefined,
    agentSequence: envelope.agent_sequence,
    sessionSequence: envelope.session_sequence ?? undefined,
  };
}

/** A call's record before any lifecycle event, with the run's tokens so far. */
export function queuedToolCall(runId: string, run: RunContext, envelope: AgentEventEnvelope, call: { id: string; name: string }): ToolExecutionRecord {
  return {
    id: toolCallRecordId(envelope.session_id, call.id),
    callId: call.id,
    ideRunId: runId,
    ...envelopeMetadata(envelope),
    toolName: call.name,
    requestedBy: requestingModel(run, envelope),
    status: "queued",
    requestedAt: iso(envelope.timestamp),
    tokens: runTokensSnapshot(run),
    origin: run.origin,
    context: run.context,
    payloadState: "full",
  };
}

/** The call a lifecycle event after ToolCallRequested belongs to. */
export function toolCallIdOf(event: AgentEvent): string | undefined {
  if ("ToolCallStarted" in event) return event.ToolCallStarted.call_id;
  if ("ToolCallProgress" in event) return event.ToolCallProgress.call_id;
  if ("ToolCallCompleted" in event) return event.ToolCallCompleted.call_id;
  if ("PermissionRequested" in event) return event.PermissionRequested.request.tool_call.id;
  return undefined;
}

function permissionRequested(request: PermissionRequest): Partial<ToolExecutionRecord> {
  const sanitized = sanitizeForObservability(request.tool_call.arguments);
  return {
    toolName: request.tool_call.name,
    arguments: sanitized.value,
    payloadState: sanitized.state,
    status: "waiting-permission",
    permission: { requestId: request.id, state: "waiting" },
  };
}

function toolCallCompleted(existing: ToolExecutionRecord, result: ToolResultSummary, finishedAt: string): Partial<ToolExecutionRecord> {
  const sanitized = sanitizeForObservability(result.output_preview);
  return {
    status: result.has_error ? "failed" : "succeeded",
    finishedAt,
    durationMs: duration(existing, finishedAt),
    resultPreview: String(sanitized.value ?? ""),
    // Once redacted, a record stays redacted.
    payloadState: existing.payloadState === "redacted" ? "redacted" : sanitized.state,
    permission: existing.permission ? { ...existing.permission, state: "resolved-by-run" } : undefined,
  };
}

/** What a lifecycle event changes on its call's record; `at` is the event's time. */
export function toolCallChange(existing: ToolExecutionRecord, event: AgentEvent, at: string): Partial<ToolExecutionRecord> {
  if ("ToolCallStarted" in event) return { status: "running", startedAt: at };
  if ("ToolCallProgress" in event) return { status: "running", progress: event.ToolCallProgress.progress };
  if ("PermissionRequested" in event) return permissionRequested(event.PermissionRequested.request);
  if ("ToolCallCompleted" in event) return toolCallCompleted(existing, event.ToolCallCompleted.result, at);
  return {};
}

/** A call a closed session or IDE reload left active, as failed. */
export function healInterrupted(record: ToolExecutionRecord): ToolExecutionRecord {
  const finishedAt = record.finishedAt ?? new Date().toISOString();
  return {
    ...record,
    status: "failed",
    finishedAt,
    durationMs: record.durationMs ?? duration(record, finishedAt),
    resultPreview: record.resultPreview ?? "Interrupted: session was closed or IDE reloaded while call was active.",
  };
}

/** The record healed when it is still active, else the same record. */
export function healIfActive(record: ToolExecutionRecord): ToolExecutionRecord {
  return ACTIVE_STATUSES.has(record.status) ? healInterrupted(record) : record;
}

function belongsToRun(record: ToolExecutionRecord, runId: string, sessionId: string | undefined): boolean {
  if (record.ideRunId === runId) return true;
  return Boolean(sessionId) && record.sessionId === sessionId;
}

/** A call of this run, or of the session it ran in, that has not finished. */
export function isActiveInRun(record: ToolExecutionRecord, runId: string, sessionId: string | undefined): boolean {
  return belongsToRun(record, runId, sessionId) && ACTIVE_STATUSES.has(record.status);
}

function unfinishedPreview(outcome: RunOutcome<CapabilityName>): string {
  if (outcome.status === "failed") return String(sanitizeForObservability(outcome.error.message).value);
  if (outcome.status === "completed") return "Run ended without a terminal tool event; tool success is unknown.";
  return "Run cancelled before a terminal tool event.";
}

/** An active call closed because its run ended without a terminal tool event. */
export function endedWithRun(
  record: ToolExecutionRecord,
  outcome: RunOutcome<CapabilityName>,
  finishedAt: string,
  runTokens: ExecutionTokensSnapshot | undefined,
): ToolExecutionRecord {
  return {
    ...record,
    status: outcome.status === "cancelled" ? "cancelled" : "failed",
    tokens: record.tokens ?? runTokens,
    finishedAt,
    durationMs: duration(record, finishedAt),
    resultPreview: record.resultPreview ?? unfinishedPreview(outcome),
  };
}
