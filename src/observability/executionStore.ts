import { trajectories, type TrajectoryStore } from "./trajectoryStore";
import type { AgentEvent, AgentEventEnvelope } from "@rusty/harness-sdk";
import type { CapabilityInput, CapabilityName, RunOutcome } from "../harness/contract";
import { createContextSnapshot, inferExecutionOrigin } from "./origin";
import {
  defaultPersistence,
  readRetentionPreference,
  sinceDayFor,
  takeLegacyItem,
  writeRetentionPreference,
  type ObservabilityPersistence,
} from "./persistence";
import { sanitizeForObservability } from "./redaction";
import type { ExecutionOrigin, ExecutionTokensSnapshot, ObservabilitySnapshot, ToolExecutionRecord } from "./types";

const LEGACY_KEY = "rusty.execution-observability.v1";
// In-memory view window only; disk history is unbounded.
const MAX_RECORDS = 1_000;
const ACTIVE_STATUSES = new Set<ToolExecutionRecord["status"]>(["queued", "waiting-permission", "running"]);

type Root = string | undefined;
const rootOf = (record: ToolExecutionRecord): Root => record.context?.workspaceRoot || undefined;

interface RunContext {
  capability: CapabilityName;
  origin: ExecutionOrigin;
  context: ToolExecutionRecord["context"];
  sessionId?: string;
  tokens?: ExecutionTokensSnapshot;
}

type Listener = () => void;

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

function healInterrupted(record: ToolExecutionRecord): ToolExecutionRecord {
  const finishedAt = record.finishedAt ?? new Date().toISOString();
  return {
    ...record,
    status: "failed",
    finishedAt,
    durationMs: record.durationMs ?? duration(record, finishedAt),
    resultPreview: record.resultPreview ?? "Interrupted: session was closed or IDE reloaded while call was active.",
  };
}

export class ExecutionObservabilityStore {
  private listeners = new Set<Listener>();
  private runs = new Map<string, RunContext>();
  private snapshot: ObservabilitySnapshot = { records: [], retentionDays: readRetentionPreference(), storageBytes: 0 };
  private dirty = new Map<string, ToolExecutionRecord>();
  private timer?: ReturnType<typeof setTimeout>;
  private roots: Root[] = [undefined];
  private rootKey?: string;
  private loadToken = 0;
  private migrated = false;

  constructor(
    private persistence: ObservabilityPersistence = defaultPersistence(),
    private trajectoryStore: TrajectoryStore = trajectories,
  ) {}

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): ObservabilitySnapshot => this.snapshot;

  /** Points the view at a workspace's `.rusty/observability` (plus app-level history) and loads it. */
  async setWorkspace(root: Root): Promise<void> {
    const key = root ?? "";
    if (this.rootKey === key) return;
    this.rootKey = key;
    this.roots = root ? [root, undefined] : [undefined];
    await Promise.all([this.load(), this.trajectoryStore.setWorkspace(root)]);
  }

  async load(): Promise<void> {
    const token = ++this.loadToken;
    await this.migrateLegacy();
    try {
      const sinceDay = sinceDayFor(this.snapshot.retentionDays);
      const results = await Promise.all(this.roots.map((root) =>
        this.persistence.load(root, { sinceDay, limit: MAX_RECORDS, trajectoryLimit: 0 })));
      if (token !== this.loadToken) return;
      const loadedRoots = new Set(this.roots);
      const unsaved = this.snapshot.records.filter((record) =>
        this.runs.has(record.ideRunId) || this.dirty.has(record.id) || !loadedRoots.has(rootOf(record)));
      const unsavedIds = new Set(unsaved.map((record) => record.id));
      const loaded: ToolExecutionRecord[] = [];
      for (const record of results.flatMap((result) => result.executions as ToolExecutionRecord[])) {
        if (unsavedIds.has(record.id)) continue;
        if (ACTIVE_STATUSES.has(record.status)) {
          const healed = healInterrupted(record);
          this.dirty.set(healed.id, healed);
          loaded.push(healed);
        } else {
          loaded.push(record);
        }
      }
      const records = [...unsaved, ...loaded]
        .sort((a, b) => b.requestedAt.localeCompare(a.requestedAt))
        .slice(0, MAX_RECORDS);
      this.snapshot = {
        ...this.snapshot,
        records,
        storageBytes: results.reduce((total, result) => total + result.bytes, 0),
        lastError: undefined,
      };
      this.emit();
      if (this.dirty.size) this.schedule();
    } catch (error) {
      this.setError(error);
    }
  }

  private async migrateLegacy() {
    if (this.migrated) return;
    this.migrated = true;
    const legacy = takeLegacyItem(LEGACY_KEY);
    if (!legacy) return;
    let records: ToolExecutionRecord[];
    try {
      const parsed = JSON.parse(legacy.raw);
      records = Array.isArray(parsed) ? parsed.filter((record) => typeof record?.id === "string") : [];
    } catch {
      legacy.remove();
      return;
    }
    try {
      const byRoot = new Map<Root, ToolExecutionRecord[]>();
      for (const record of records) {
        const healed = ACTIVE_STATUSES.has(record.status) ? healInterrupted(record) : record;
        byRoot.set(rootOf(healed), [...(byRoot.get(rootOf(healed)) ?? []), healed]);
      }
      for (const [root, rows] of byRoot) await this.persistence.append(root, "executions", rows);
      legacy.remove();
    } catch (error) {
      this.setError(error);
    }
  }

  startRun<K extends CapabilityName>(runId: string, capability: K, input: CapabilityInput<K>, origin?: Partial<ExecutionOrigin>): void {
    this.trajectoryStore.start(runId, inferExecutionOrigin(capability, input, origin), createContextSnapshot(capability, input));
    this.runs.set(runId, {
      capability,
      origin: inferExecutionOrigin(capability, input, origin),
      context: createContextSnapshot(capability, input),
    });
  }

  bindSession(runId: string, sessionId: string): void {
    this.trajectoryStore.bind(runId, sessionId);
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
    this.trajectoryStore.append(runId, Object.keys(event)[0], event, {
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
    this.trajectoryStore.finish(runId, outcome.status, outcome);
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
    void this.flush();
  }

  /** Changes how many days the view loads; history on disk is never pruned. */
  async setRetention(days: ObservabilitySnapshot["retentionDays"]): Promise<void> {
    writeRetentionPreference(days);
    this.snapshot = { ...this.snapshot, retentionDays: days };
    this.emit();
    await Promise.all([this.load(), this.trajectoryStore.setRetention(days)]);
  }

  async deleteExecution(id: string): Promise<void> {
    const record = this.snapshot.records.find((candidate) => candidate.id === id);
    this.dirty.delete(id);
    this.replace(this.snapshot.records.filter((candidate) => candidate.id !== id));
    await this.persist((root) => this.persistence.delete(root, { kind: "execution", id }), [record ? rootOf(record) : undefined]);
  }

  async deleteSession(sessionId: string): Promise<void> {
    const roots = this.knownRoots(this.snapshot.records.filter((record) => record.sessionId === sessionId));
    this.trajectoryStore.remove((run) => run.sessionId === sessionId, { persist: false });
    this.dropDirty((record) => record.sessionId === sessionId);
    this.replace(this.snapshot.records.filter((record) => record.sessionId !== sessionId));
    await this.persist((root) => this.persistence.delete(root, { kind: "session", id: sessionId }), roots);
  }

  async deleteWorkspace(workspaceId: string): Promise<void> {
    this.trajectoryStore.remove((run) => run.origin.workspaceId === workspaceId, { persist: false });
    this.dropDirty((record) => record.origin.workspaceId === workspaceId);
    this.replace(this.snapshot.records.filter((record) => record.origin.workspaceId !== workspaceId));
    await this.persist((root) => this.persistence.delete(root, { kind: "all" }), [workspaceId]);
    this.trajectoryStore.repersistLive((run) => run.context?.workspaceRoot === workspaceId);
  }

  async clear(): Promise<void> {
    const roots = this.knownRoots(this.snapshot.records);
    this.trajectoryStore.remove(() => true, { persist: false });
    const kept = this.snapshot.records.filter((record) => this.runs.has(record.ideRunId) && ACTIVE_STATUSES.has(record.status));
    this.dirty.clear();
    this.replace(kept);
    await this.persist((root) => this.persistence.delete(root, { kind: "all" }), roots);
    this.repersistActive();
    this.snapshot = { ...this.snapshot, storageBytes: 0 };
    this.emit();
  }

  flush = async (): Promise<void> => {
    clearTimeout(this.timer);
    this.timer = undefined;
    if (this.dirty.size === 0) return;
    const batch = [...this.dirty.values()];
    this.dirty.clear();
    const byRoot = new Map<Root, ToolExecutionRecord[]>();
    for (const record of batch) byRoot.set(rootOf(record), [...(byRoot.get(rootOf(record)) ?? []), record]);
    try {
      for (const [root, rows] of byRoot) await this.persistence.append(root, "executions", rows);
      if (this.snapshot.lastError) this.setError(undefined);
    } catch (error) {
      for (const record of batch) if (!this.dirty.has(record.id)) this.dirty.set(record.id, record);
      this.setError(error);
    }
  };

  private knownRoots(records: ToolExecutionRecord[]): Root[] {
    return [...new Set<Root>([...this.roots, ...records.map(rootOf)])];
  }

  private async persist(action: (root: Root) => Promise<void>, roots: Root[]): Promise<void> {
    try {
      for (const root of new Set(roots)) await action(root);
    } catch (error) {
      this.setError(error);
    }
  }

  private dropDirty(matches: (record: ToolExecutionRecord) => boolean) {
    for (const [id, record] of this.dirty) if (matches(record)) this.dirty.delete(id);
  }

  private repersistActive() {
    for (const record of this.snapshot.records) this.dirty.set(record.id, record);
    this.trajectoryStore.repersistLive();
    this.schedule();
  }

  private upsert(record: ToolExecutionRecord): void {
    const index = this.snapshot.records.findIndex((candidate) => candidate.id === record.id);
    const records = [...this.snapshot.records];
    if (index === -1) records.unshift(record);
    else records[index] = record;
    this.replace(records.slice(0, MAX_RECORDS));
  }

  /** Every mutation builds new record objects, so identity tells which ones need writing. */
  private replace(records: ToolExecutionRecord[]): void {
    const previous = new Set(this.snapshot.records);
    for (const record of records) if (!previous.has(record)) this.dirty.set(record.id, record);
    this.snapshot = { ...this.snapshot, records };
    this.emit();
    if (this.dirty.size) this.schedule();
  }

  private schedule() {
    if (!this.timer) this.timer = setTimeout(() => void this.flush(), 1000);
  }

  private setError(error: unknown) {
    this.snapshot = { ...this.snapshot, lastError: error === undefined ? undefined : error instanceof Error ? error.message : String(error) };
    this.emit();
  }

  private emit() {
    for (const listener of this.listeners) listener();
  }
}

export const executionObservability = new ExecutionObservabilityStore();
