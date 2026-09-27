import { trajectories, type TrajectoryStore } from "./trajectoryStore";
import type { AgentEvent, AgentEventEnvelope } from "@rusty/harness-sdk";
import type { CapabilityInput, CapabilityName, RunOutcome } from "../harness/contract";
import {
  NOOP_TOOL_EXECUTION_OBSERVER,
  type ToolExecutionObserver,
  type ToolExecutionStepLevel,
} from "../harness/contract/observability";
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
import type {
  ExecutionOrigin,
  ExecutionTokensSnapshot,
  ObservabilitySnapshot,
  ToolExecutionDetail,
  ToolExecutionRecord,
} from "./types";

const LEGACY_KEY = "rusty.execution-observability.v1";
// In-memory view window only; disk history is unbounded.
const MAX_RECORDS = 1_000;
const ACTIVE_STATUSES = new Set<ToolExecutionRecord["status"]>(["queued", "waiting-permission", "running"]);
const MAX_EXECUTION_STEPS = 100;

type Root = string | undefined;
const rootOf = (record: ToolExecutionRecord): Root => record.context?.workspaceRoot || undefined;

interface RunContext {
  capability: CapabilityName;
  origin: ExecutionOrigin;
  context: ToolExecutionRecord["context"];
  sessionId?: string;
  /** The run's own model(s), summed: what a record captures when requested. */
  tokens?: ExecutionTokensSnapshot;
  tokensByModel: Map<string, ExecutionTokensSnapshot>;
  /** Which model each session and agent runs on, for `requestedBy`. */
  sessionModels: Map<string, string>;
  agentModels: Map<string, string>;
  /** agent_spawn call record id -> the `model` it asked for, if any. */
  spawnModels: Map<string, string | undefined>;
  /** Child agent id -> the agent_spawn call record that created it. */
  childSpawnCalls: Map<string, string>;
}

const AGENT_SPAWN_TOOL = "agent_spawn";

/** rusty-core names MCP tools `mcp__<server>__<tool>`. */
function mcpServerOf(toolName: string): string | undefined {
  const match = /^mcp__(.+?)__/.exec(toolName);
  return match?.[1];
}

/** Which model a usage report belongs to. */
export interface UsageSource {
  model?: string;
  provider?: string;
  role?: "run" | "subagent";
  /** The agent that spent it, and this report's increment: a subagent's
   * increments are also credited to the agent_spawn call that created it. */
  agentId?: string;
  delta?: unknown;
}

const NOTIFY_INTERVAL_MS = 120;
const TOKEN_FIELDS = ["totalTokens", "inputTokens", "outputTokens", "cacheReadTokens", "cacheWriteTokens", "reasoningTokens"] as const;

function addTokens(target: ExecutionTokensSnapshot | undefined, delta: ExecutionTokensSnapshot): ExecutionTokensSnapshot {
  const sum: ExecutionTokensSnapshot = { ...target };
  for (const field of TOKEN_FIELDS) {
    if (delta[field] !== undefined) sum[field] = (sum[field] ?? 0) + delta[field]!;
  }
  return sum;
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

/** Normalizes any usage shape we receive (rusty-core `UsageUpdated`, with or
 * without its `metrics` wrapper, `ModelUsage`, or the IDE's camelCase
 * `TokenUsage`) into one snapshot. */
export function parseUsageTokens(usage: unknown): ExecutionTokensSnapshot {
  const outer = usage && typeof usage === "object" ? usage as Record<string, unknown> : {};
  const u = outer.metrics && typeof outer.metrics === "object" ? outer.metrics as Record<string, unknown> : outer;
  return {
    totalTokens: parseTokenCount(u.total_tokens ?? u.totalTokens ?? u.total),
    inputTokens: parseTokenCount(u.input_tokens ?? u.inputTokens ?? u.input),
    outputTokens: parseTokenCount(u.output_tokens ?? u.outputTokens ?? u.output),
    cacheReadTokens: parseTokenCount(u.cache_read_tokens ?? u.cacheReadTokens ?? u.cacheRead),
    cacheWriteTokens: parseTokenCount(u.cache_write_tokens ?? u.cacheWriteTokens ?? u.cacheWrite),
    reasoningTokens: parseTokenCount(u.reasoning_tokens ?? u.reasoningTokens ?? u.reasoning),
  };
}

function definedTokens(tokens: ExecutionTokensSnapshot): ExecutionTokensSnapshot {
  return Object.fromEntries(Object.entries(tokens).filter(([, value]) => value !== undefined));
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
  /** Execution details tools reported, keyed by record id. Held separately
   * because a tool's first report can arrive before the `ToolCallRequested`
   * event that creates its record; `upsert` attaches them either way. */
  private toolDetails = new Map<string, { runId: string; detail: ToolExecutionDetail }>();
  private notifyTimer?: ReturnType<typeof setTimeout>;
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
      tokensByModel: new Map(),
      sessionModels: new Map(),
      agentModels: new Map(),
      spawnModels: new Map(),
      childSpawnCalls: new Map(),
    });
  }

  /** `model` is the model the session runs on (orchestrated runs may use a
   * different one per session). */
  bindSession(runId: string, sessionId: string, model?: string): void {
    this.trajectoryStore.bind(runId, sessionId);
    const run = this.runs.get(runId);
    if (!run) return;
    run.sessionId ??= sessionId;
    if (model) run.sessionModels.set(sessionId, model);
  }

  private requestingModel(run: RunContext, envelope: AgentEventEnvelope): ToolExecutionRecord["requestedBy"] {
    const subagent = Boolean(envelope.parent_agent_id);
    const model = run.agentModels.get(envelope.agent_id)
      ?? (envelope.session_id ? run.sessionModels.get(envelope.session_id) : undefined)
      ?? run.context.model;
    return { model, provider: run.context.provider, ...(subagent ? { subagent } : {}) };
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

    // Usage arrives through recordUsage(), already accumulated per model by
    // the harness; a raw UsageUpdated is only one request's snapshot. It does
    // name the model the agent runs on, which later calls are attributed to.
    if ("UsageUpdated" in event) {
      const model = (event.UsageUpdated.usage as { model?: unknown }).model;
      if (typeof model === "string" && model) run.agentModels.set(envelope.agent_id, model);
      return;
    }

    if ("ChildAgentSpawned" in event) {
      const spawned = event.ChildAgentSpawned as { agent_id: string; tool_call_id?: string | null };
      if (!spawned.tool_call_id || !envelope.session_id) return;
      const spawnId = `${envelope.session_id}:${spawned.tool_call_id}`;
      const model = run.spawnModels.get(spawnId)
        ?? run.agentModels.get(envelope.agent_id)
        ?? run.sessionModels.get(envelope.session_id)
        ?? run.context.model;
      run.childSpawnCalls.set(spawned.agent_id, spawnId);
      if (model && !run.agentModels.has(spawned.agent_id)) run.agentModels.set(spawned.agent_id, model);
      this.reportToolExecution(runId, spawnId, (detail) => ({
        ...detail,
        executor: { kind: "model", purpose: "Subagent", model, provider: run.context.provider },
      }));
      return;
    }

    if ("ToolCallRequested" in event) {
      const call = event.ToolCallRequested.call;
      const sanitized = sanitizeForObservability(call.arguments);
      const id = `${envelope.session_id}:${call.id}`;
      if (call.name === AGENT_SPAWN_TOOL) {
        const requested = (call.arguments as { model?: unknown } | null)?.model;
        run.spawnModels.set(id, typeof requested === "string" && requested ? requested : undefined);
      }
      const server = mcpServerOf(call.name);
      if (server) {
        this.reportToolExecution(runId, id, (detail) => ({ ...detail, executor: detail.executor ?? { kind: "service", purpose: "MCP tool", provider: server } }));
      }
      this.upsert({
        id,
        callId: call.id,
        ideRunId: runId,
        ...metadata,
        toolName: call.name,
        requestedBy: this.requestingModel(run, envelope),
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
      requestedBy: this.requestingModel(run, envelope),
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

  /** The observer a host tool handler receives for one call. `toolCallId`
   * is the model-facing call id (the bridge forwards it); without it the
   * call can't be matched to its record, so reports are dropped. */
  toolObserver(runId: string, sessionId: string, toolCallId: string | undefined): ToolExecutionObserver {
    if (!toolCallId) return NOOP_TOOL_EXECUTION_OBSERVER;
    const id = `${sessionId}:${toolCallId}`;
    const report = (update: (detail: ToolExecutionDetail) => ToolExecutionDetail) => {
      try {
        this.reportToolExecution(runId, id, update);
      } catch (error) {
        console.warn("Tool execution observability failed without affecting the tool:", error);
      }
    };
    return {
      executedBy: (executor) => report((detail) => ({ ...detail, executor: { ...executor } })),
      usage: (usage) => report((detail) => {
        const delta = definedTokens(parseUsageTokens(usage));
        const executor = detail.executor;
        const model = executor?.model ?? executor?.provider ?? "unknown";
        this.trajectoryStore.addUsage(runId, `tool:${model}`, {
          model,
          provider: executor?.provider,
          role: "tool",
          purpose: executor?.purpose,
        }, delta);
        return { ...detail, tokens: addTokens(detail.tokens, delta) };
      }),
      step: (level: ToolExecutionStepLevel, message: string, details?: unknown) =>
        report((detail) => ({
          ...detail,
          steps: [
            ...detail.steps,
            { at: new Date().toISOString(), level, message, ...(details === undefined ? {} : { details: sanitizeForObservability(details).value }) },
          ].slice(-MAX_EXECUTION_STEPS),
        })),
    };
  }

  private reportToolExecution(runId: string, id: string, update: (detail: ToolExecutionDetail) => ToolExecutionDetail): void {
    const detail = update(this.toolDetails.get(id)?.detail ?? { steps: [] });
    this.toolDetails.set(id, { runId, detail });
    const existing = this.snapshot.records.find((record) => record.id === id);
    if (existing) this.upsert(existing);
  }

  /** `usage` is the run's running total for `source.model` (all requests so
   * far). Kept on the run, not copied into every record, so a streaming
   * session doesn't rewrite and re-persist its whole call history per event. */
  recordUsage(runId: string, usage: unknown, source: UsageSource = {}): void {
    const run = this.runs.get(runId);
    if (!usage || !run) return;
    const model = source.model ?? run.context.model ?? "unknown";
    const role = source.role ?? "run";
    const tokens = definedTokens(parseUsageTokens(usage));
    run.tokensByModel.set(`${role}:${model}`, tokens);
    run.tokens = [...run.tokensByModel.values()].reduce<ExecutionTokensSnapshot>((sum, entry) => addTokens(sum, entry), {});
    this.trajectoryStore.setUsage(runId, `${role}:${model}`, {
      model,
      provider: source.provider ?? run.context.provider,
      role,
      ...(role === "subagent" ? { purpose: "Subagent" } : {}),
      tokens,
    });
    if (source.agentId) {
      if (source.model) run.agentModels.set(source.agentId, source.model);
      const spawnId = run.childSpawnCalls.get(source.agentId);
      const delta = source.delta ? definedTokens(parseUsageTokens(source.delta)) : undefined;
      if (spawnId && delta && Object.keys(delta).length) {
        this.reportToolExecution(runId, spawnId, (detail) => ({ ...detail, tokens: addTokens(detail.tokens, delta) }));
      }
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
    for (const [id, entry] of this.toolDetails) if (entry.runId === runId) this.toolDetails.delete(id);
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

  private upsert(incoming: ToolExecutionRecord): void {
    const reported = this.toolDetails.get(incoming.id)?.detail;
    const record = reported ? { ...incoming, execution: reported } : incoming;
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

  /** The snapshot is always current; subscribers are notified at most every
   * NOTIFY_INTERVAL_MS so a streaming session doesn't re-render per event. */
  private emit() {
    if (this.notifyTimer) return;
    this.notifyTimer = setTimeout(() => {
      this.notifyTimer = undefined;
      for (const listener of this.listeners) listener();
    }, NOTIFY_INTERVAL_MS);
  }
}

export const executionObservability = new ExecutionObservabilityStore();
