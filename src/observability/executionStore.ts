import { trajectories } from "./trajectoryStore";
import type { AgentEvent, AgentEventEnvelope } from "@rusty/harness-sdk";
import type { CapabilityInput, CapabilityName, RunOutcome } from "../harness/contract";
import { createContextSnapshot, inferExecutionOrigin } from "./origin";
import { sanitizeForObservability } from "./redaction";
import type { ExecutionOrigin, ExecutionTokensSnapshot, ObservabilitySnapshot, ToolExecutionRecord } from "./types";

const STORAGE_KEY = "rusty.execution-observability.v1";
const RETENTION_KEY = "rusty.execution-observability.retention.v1";
const MAX_RECORDS = 1_000;
const ACTIVE_STATUSES = new Set<ToolExecutionRecord["status"]>(["queued", "waiting-permission", "running"]);

interface RunContext {
  capability: CapabilityName;
  origin: ExecutionOrigin;
  context: ToolExecutionRecord["context"];
  sessionId?: string;
  tokens?: ExecutionTokensSnapshot;
}

type Listener = () => void;

function storage(): Storage | undefined {
  try { return globalThis.localStorage; } catch { return undefined; }
}

function readRetention(): ObservabilitySnapshot["retentionDays"] {
  const value = storage()?.getItem(RETENTION_KEY);
  return value === "7" || value === "30" || value === "90" ? Number(value) as 7 | 30 | 90 : value === "unlimited" ? null : 30;
}

function iso(value?: string): string {
  return value || new Date().toISOString();
}

function duration(record: ToolExecutionRecord, finishedAt: string): number | undefined {
  const start = record.startedAt ?? record.requestedAt;
  const millis = Date.parse(finishedAt) - Date.parse(start);
  return Number.isFinite(millis) && millis >= 0 ? millis : undefined;
}

function parseTokenCount(val: unknown): number | undefined {
  if (typeof val === "number" && !isNaN(val)) return val;
  if (Array.isArray(val) && typeof val[0] === "number" && !isNaN(val[0])) return val[0];
  if (val && typeof val === "object") {
    const raw = (val as Record<string, unknown>)[0] ?? (val as Record<string, unknown>).value;
    if (typeof raw === "number" && !isNaN(raw)) return raw;
  }
  return undefined;
}

export class ExecutionObservabilityStore {
  private listeners = new Set<Listener>();
  private runs = new Map<string, RunContext>();
  private snapshot: ObservabilitySnapshot = { records: [], retentionDays: readRetention(), storageBytes: 0 };
  private hydrated = false;

  subscribe = (listener: Listener): (() => void) => {
    this.hydrate();
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): ObservabilitySnapshot => {
    this.hydrate();
    return this.snapshot;
  };

  startRun<K extends CapabilityName>(runId: string, capability: K, input: CapabilityInput<K>, origin?: Partial<ExecutionOrigin>): void {
    this.hydrate();
    trajectories.start(runId, inferExecutionOrigin(capability, input, origin), createContextSnapshot(capability, input));
    this.runs.set(runId, {
      capability,
      origin: inferExecutionOrigin(capability, input, origin),
      context: createContextSnapshot(capability, input),
    });
  }

  bindSession(runId: string, sessionId: string): void {
    trajectories.bind(runId, sessionId);
    const run = this.runs.get(runId);
    if (run) run.sessionId = sessionId;
  }

  ingest(runId: string, envelope: AgentEventEnvelope): void {
    const event = envelope.event as AgentEvent;
    const run = this.runs.get(runId);
    if (!run) return;
    if (envelope.session_id && !run.sessionId) {
      run.sessionId = envelope.session_id;
    }
    trajectories.append(runId, Object.keys(event)[0], event, {
      id: envelope.event_id, timestamp: envelope.timestamp, agentId: envelope.agent_id,
      sequence: envelope.session_sequence ?? envelope.agent_sequence,
    });
    const metadata = {
      sessionId: envelope.session_id,
      coreRunId: envelope.run_id ?? undefined,
      agentId: envelope.agent_id,
      parentAgentId: envelope.parent_agent_id ?? undefined,
      agentSequence: envelope.agent_sequence,
      sessionSequence: envelope.session_sequence ?? undefined,
    };

    if ("UsageUpdated" in event) {
      const usagePayload = (event.UsageUpdated as unknown as { usage?: { metrics?: unknown } })?.usage;
      const metrics = (usagePayload && typeof usagePayload === "object" && "metrics" in usagePayload
        ? usagePayload.metrics
        : usagePayload) as Record<string, unknown> | undefined;

      const totalTokens = parseTokenCount(metrics?.total_tokens ?? metrics?.total ?? metrics?.totalTokens);
      const inputTokens = parseTokenCount(metrics?.input_tokens ?? metrics?.input ?? metrics?.inputTokens);
      const outputTokens = parseTokenCount(metrics?.output_tokens ?? metrics?.output ?? metrics?.outputTokens);
      const cacheReadTokens = parseTokenCount(metrics?.cache_read_tokens ?? metrics?.cacheRead ?? metrics?.cacheReadTokens);
      const cacheWriteTokens = parseTokenCount(metrics?.cache_write_tokens ?? metrics?.cacheWrite ?? metrics?.cacheWriteTokens);
      const reasoningTokens = parseTokenCount(metrics?.reasoning_tokens ?? metrics?.reasoning ?? metrics?.reasoningTokens);

      const tokens: ExecutionTokensSnapshot = {
        totalTokens,
        inputTokens,
        outputTokens,
        cacheReadTokens,
        cacheWriteTokens,
        reasoningTokens,
      };

      run.tokens = { ...run.tokens, ...tokens };

      let changed = false;
      const records = this.snapshot.records.map((record) => {
        if (record.ideRunId === runId || (envelope.session_id && record.sessionId === envelope.session_id)) {
          changed = true;
          return { ...record, tokens: { ...record.tokens, ...tokens } };
        }
        return record;
      });
      if (changed) this.replace(records);
      return;
    }

    if ("ToolCallRequested" in event) {
      const call = event.ToolCallRequested.call;
      const sanitized = sanitizeForObservability(call.arguments);
      const id = `${envelope.session_id}:${call.id}`;
      this.upsert({
        id,
        callId: call.id,
        ideRunId: runId,
        ...metadata,
        toolName: call.name,
        status: "queued",
        requestedAt: iso(envelope.timestamp),
        tokens: run.tokens ? { ...run.tokens } : undefined,
        arguments: sanitized.value,
        origin: run.origin,
        context: run.context,
        payloadState: sanitized.state,
      });
      return;
    }

    const callId = "ToolCallStarted" in event ? event.ToolCallStarted.call_id
      : "ToolCallProgress" in event ? event.ToolCallProgress.call_id
      : "ToolCallCompleted" in event ? event.ToolCallCompleted.call_id
      : "PermissionRequested" in event ? event.PermissionRequested.request.tool_call.id
      : undefined;
    if (!callId) return;
    const id = `${envelope.session_id}:${callId}`;
    const existing: ToolExecutionRecord = this.snapshot.records.find((record) => record.id === id) ?? {
      id,
      callId,
      ideRunId: runId,
      ...metadata,
      toolName: "PermissionRequested" in event ? event.PermissionRequested.request.tool_call.name : "Unknown tool",
      status: "queued" as const,
      requestedAt: iso(envelope.timestamp),
      tokens: run.tokens ? { ...run.tokens } : undefined,
      origin: run.origin,
      context: run.context,
      payloadState: "full" as const,
    };

    if ("ToolCallStarted" in event) {
      this.upsert({ ...existing, ...metadata, tokens: existing.tokens ?? (run.tokens ? { ...run.tokens } : undefined), status: "running", startedAt: iso(envelope.timestamp) });
    } else if ("ToolCallProgress" in event) {
      this.upsert({ ...existing, ...metadata, tokens: existing.tokens ?? (run.tokens ? { ...run.tokens } : undefined), status: "running", progress: event.ToolCallProgress.progress });
    } else if ("PermissionRequested" in event) {
      const request = event.PermissionRequested.request;
      const sanitized = sanitizeForObservability(request.tool_call.arguments);
      this.upsert({
        ...existing,
        ...metadata,
        toolName: request.tool_call.name,
        arguments: sanitized.value,
        tokens: existing.tokens ?? (run.tokens ? { ...run.tokens } : undefined),
        payloadState: sanitized.state,
        status: "waiting-permission",
        permission: { requestId: request.id, state: "waiting" },
      });
    } else if ("ToolCallCompleted" in event) {
      const finishedAt = iso(envelope.timestamp);
      const failed = event.ToolCallCompleted.result.has_error;
      const sanitized = sanitizeForObservability(event.ToolCallCompleted.result.output_preview);
      this.upsert({
        ...existing,
        ...metadata,
        status: failed ? "failed" : "succeeded",
        finishedAt,
        durationMs: duration(existing, finishedAt),
        tokens: existing.tokens ?? (run.tokens ? { ...run.tokens } : undefined),
        resultPreview: String(sanitized.value ?? ""),
        payloadState: existing.payloadState === "redacted" || sanitized.state === "redacted" ? "redacted" : sanitized.state,
        permission: existing.permission ? { ...existing.permission, state: "resolved-by-run" } : undefined,
      });
    }
  }

  recordUsage(runId: string, usage: unknown): void {
    this.hydrate();
    const u = usage as Record<string, unknown> | undefined;
    if (!u) return;
    const totalTokens = parseTokenCount(u.totalTokens ?? u.total ?? u.total_tokens);
    const inputTokens = parseTokenCount(u.inputTokens ?? u.input ?? u.input_tokens);
    const outputTokens = parseTokenCount(u.outputTokens ?? u.output ?? u.output_tokens);
    const cacheReadTokens = parseTokenCount(u.cacheReadTokens ?? u.cacheRead ?? u.cache_read_tokens);
    const cacheWriteTokens = parseTokenCount(u.cacheWriteTokens ?? u.cacheWrite ?? u.cache_write_tokens);
    const reasoningTokens = parseTokenCount(u.reasoningTokens ?? u.reasoning ?? u.reasoning_tokens);

    const tokens: ExecutionTokensSnapshot = {
      totalTokens,
      inputTokens,
      outputTokens,
      cacheReadTokens,
      cacheWriteTokens,
      reasoningTokens,
    };

    const run = this.runs.get(runId);
    if (run) {
      run.tokens = { ...run.tokens, ...tokens };
    }

    let changed = false;
    const records = this.snapshot.records.map((record) => {
      if (record.ideRunId === runId) {
        changed = true;
        return { ...record, tokens: { ...record.tokens, ...tokens } };
      }
      return record;
    });
    if (changed) {
      this.replace(records);
    }
  }

  finishRun<K extends CapabilityName>(runId: string, outcome: RunOutcome<K>): void {
    trajectories.finish(runId, outcome.status, outcome);
    const finishedAt = new Date().toISOString();
    let changed = false;
    const run = this.runs.get(runId);
    const records = this.snapshot.records.map((record) => {
      const matchesRun = record.ideRunId === runId || (run?.sessionId && record.sessionId === run.sessionId);
      if (!matchesRun || !["queued", "waiting-permission", "running"].includes(record.status)) return record;
      changed = true;
      const status: ToolExecutionRecord["status"] = outcome.status === "cancelled" ? "cancelled" : "failed";
      return {
        ...record,
        status,
        tokens: record.tokens ?? (run?.tokens ? { ...run.tokens } : undefined),
        finishedAt,
        durationMs: duration(record, finishedAt),
        resultPreview: record.resultPreview ?? (outcome.status === "failed" ? String(sanitizeForObservability(outcome.error.message).value) : outcome.status === "completed" ? "Run ended without a terminal tool event; tool success is unknown." : "Run cancelled before a terminal tool event."),
      };
    });
    this.runs.delete(runId);
    if (changed) this.replace(records);
  }

  setRetention(days: ObservabilitySnapshot["retentionDays"]): void {
    this.hydrate();
    storage()?.setItem(RETENTION_KEY, days === null ? "unlimited" : String(days));
    trajectories.setRetention(days);
    this.snapshot = { ...this.snapshot, retentionDays: days };
    this.prune();
  }

  deleteExecution(id: string): void { this.hydrate(); this.replace(this.snapshot.records.filter((record) => record.id !== id)); }
  deleteSession(sessionId: string): void { trajectories.remove((run) => run.sessionId === sessionId); this.hydrate(); this.replace(this.snapshot.records.filter((record) => record.sessionId !== sessionId)); }
  deleteWorkspace(workspaceId: string): void { trajectories.remove((run) => run.origin.workspaceId === workspaceId); this.hydrate(); this.replace(this.snapshot.records.filter((record) => record.origin.workspaceId !== workspaceId)); }
  clear(): void { trajectories.remove(() => true); this.hydrate(); this.replace(this.snapshot.records.filter((record) => this.runs.has(record.ideRunId) && ACTIVE_STATUSES.has(record.status))); }

  private hydrate(): void {
    if (this.hydrated) return;
    this.hydrated = true;
    try {
      const raw = storage()?.getItem(STORAGE_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      const records = (Array.isArray(parsed) ? parsed as ToolExecutionRecord[] : []).map((record) => {
        if (ACTIVE_STATUSES.has(record.status)) {
          const finishedAt = record.finishedAt ?? new Date().toISOString();
          return {
            ...record,
            status: "failed" as const,
            finishedAt,
            durationMs: record.durationMs ?? duration(record, finishedAt),
            resultPreview: record.resultPreview ?? "Interrupted: session was closed or IDE reloaded while call was active.",
          };
        }
        return record;
      });
      this.snapshot = { ...this.snapshot, records, storageBytes: raw?.length ?? 0 };
      this.prune();
    } catch (error) {
      this.snapshot = { ...this.snapshot, lastError: error instanceof Error ? error.message : String(error) };
    }
  }

  private prune(): void {
    const cutoff = this.snapshot.retentionDays === null ? Number.NEGATIVE_INFINITY : Date.now() - this.snapshot.retentionDays * 86_400_000;
    const records = this.snapshot.records
      .filter((record) => ACTIVE_STATUSES.has(record.status) || Date.parse(record.requestedAt) >= cutoff)
      .slice(0, MAX_RECORDS);
    this.replace(records);
  }

  private upsert(record: ToolExecutionRecord): void {
    const index = this.snapshot.records.findIndex((candidate) => candidate.id === record.id);
    const records = [...this.snapshot.records];
    if (index === -1) records.unshift(record);
    else records[index] = record;
    this.replace(records.slice(0, MAX_RECORDS));
  }

  private replace(records: ToolExecutionRecord[]): void {
    let raw = "";
    let lastError: string | undefined;
    try {
      raw = JSON.stringify(records);
      storage()?.setItem(STORAGE_KEY, raw);
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    this.snapshot = { ...this.snapshot, records, storageBytes: raw.length, lastError };
    for (const listener of this.listeners) listener();
  }
}

export const executionObservability = new ExecutionObservabilityStore();
