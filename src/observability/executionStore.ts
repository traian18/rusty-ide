// The live view of tool executions: the store turns harness events into
// records, keeps the newest in memory for the UI, and hands changes to its
// writer. The parts it builds on live beside it: usageTokens.ts (usage
// shapes), runContext.ts (which model a call or token belongs to),
// toolCallRecords.ts (a record's lifecycle) and executionWriter.ts (disk).

import { trajectories, type TrajectoryStore } from "./trajectoryStore";
import type { AgentEvent, AgentEventEnvelope, ToolCall } from "@rusty/harness-sdk";
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
  writeRetentionPreference,
  type ObservabilityPersistence,
} from "./persistence";
import { sanitizeForObservability } from "./redaction";
import type {
  ExecutionOrigin,
  ObservabilitySnapshot,
  ToolExecutionDetail,
  ToolExecutionRecord,
} from "./types";
import { addTokens, definedTokens, parseUsageTokens } from "./usageTokens";
import {
  adoptChildAgent,
  createRunContext,
  noteAgentModel,
  noteSpawnRequest,
  runTokensSnapshot,
  setModelTokens,
  type RunContext,
} from "./runContext";
import {
  ACTIVE_STATUSES,
  endedWithRun,
  envelopeMetadata,
  healInterrupted,
  iso,
  isActiveInRun,
  queuedToolCall,
  toolCallChange,
  toolCallIdOf,
  toolCallRecordId,
} from "./toolCallRecords";
import { ExecutionRecordWriter, rootOf, type Root } from "./executionWriter";

export { parseUsageTokens } from "./usageTokens";

const LEGACY_KEY = "rusty.execution-observability.v1";
// In-memory view window only; disk history is unbounded.
const MAX_RECORDS = 1_000;
const MAX_EXECUTION_STEPS = 100;

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

type Listener = () => void;

export class ExecutionObservabilityStore {
  private listeners = new Set<Listener>();
  private runs = new Map<string, RunContext>();
  /** Execution details tools reported, keyed by record id. Held separately
   * because a tool's first report can arrive before the `ToolCallRequested`
   * event that creates its record; `upsert` attaches them either way. */
  private toolDetails = new Map<string, { runId: string; detail: ToolExecutionDetail }>();
  private notifyTimer?: ReturnType<typeof setTimeout>;
  private snapshot: ObservabilitySnapshot = { records: [], retentionDays: readRetentionPreference(), storageBytes: 0 };
  private writer: ExecutionRecordWriter;
  private roots: Root[] = [undefined];
  private rootKey?: string;
  private loadToken = 0;

  constructor(
    private persistence: ObservabilityPersistence = defaultPersistence(),
    private trajectoryStore: TrajectoryStore = trajectories,
  ) {
    this.writer = new ExecutionRecordWriter(persistence, () => this.flush());
  }

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
    await this.writer.migrateLegacy(LEGACY_KEY).catch((error) => this.setError(error));
    try {
      const sinceDay = sinceDayFor(this.snapshot.retentionDays);
      const results = await Promise.all(this.roots.map((root) =>
        this.persistence.load(root, { sinceDay, limit: MAX_RECORDS, trajectoryLimit: 0 })));
      if (token !== this.loadToken) return;
      const loadedRoots = new Set(this.roots);
      const unsaved = this.snapshot.records.filter((record) =>
        this.runs.has(record.ideRunId) || this.writer.has(record.id) || !loadedRoots.has(rootOf(record)));
      const unsavedIds = new Set(unsaved.map((record) => record.id));
      const loaded: ToolExecutionRecord[] = [];
      for (const record of results.flatMap((result) => result.executions as ToolExecutionRecord[])) {
        if (unsavedIds.has(record.id)) continue;
        if (ACTIVE_STATUSES.has(record.status)) {
          const healed = healInterrupted(record);
          this.writer.queue(healed);
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
      this.writer.scheduleIfPending();
    } catch (error) {
      this.setError(error);
    }
  }

  startRun<K extends CapabilityName>(runId: string, capability: K, input: CapabilityInput<K>, origin?: Partial<ExecutionOrigin>): void {
    this.trajectoryStore.start(runId, inferExecutionOrigin(capability, input, origin), createContextSnapshot(capability, input));
    this.runs.set(runId, createRunContext(capability, inferExecutionOrigin(capability, input, origin), createContextSnapshot(capability, input)));
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

    if ("UsageUpdated" in event) {
      // Usage arrives through recordUsage(), already accumulated per model by
      // the harness; a raw UsageUpdated is only one request's snapshot. It does
      // name the model the agent runs on, which later calls are attributed to.
      noteAgentModel(run, envelope.agent_id, event.UsageUpdated.usage);
    } else if ("ChildAgentSpawned" in event) {
      this.childAgentSpawned(runId, run, envelope, event.ChildAgentSpawned as { agent_id: string; tool_call_id?: string | null });
    } else if ("ToolCallRequested" in event) {
      this.toolCallRequested(runId, run, envelope, event.ToolCallRequested.call);
    } else {
      this.toolCallUpdated(runId, run, envelope, event);
    }
  }

  /** Credits the subagent to the agent_spawn call that created it. */
  private childAgentSpawned(runId: string, run: RunContext, envelope: AgentEventEnvelope, spawned: { agent_id: string; tool_call_id?: string | null }): void {
    if (!spawned.tool_call_id || !envelope.session_id) return;
    const spawnId = toolCallRecordId(envelope.session_id, spawned.tool_call_id);
    const model = adoptChildAgent(run, envelope, spawned.agent_id, spawnId);
    this.reportToolExecution(runId, spawnId, (detail) => ({
      ...detail,
      executor: { kind: "model", purpose: "Subagent", model, provider: run.context.provider },
    }));
  }

  private toolCallRequested(runId: string, run: RunContext, envelope: AgentEventEnvelope, call: ToolCall): void {
    const record = queuedToolCall(runId, run, envelope, call);
    noteSpawnRequest(run, record.id, call);
    const server = mcpServerOf(call.name);
    if (server) {
      this.reportToolExecution(runId, record.id, (detail) => ({ ...detail, executor: detail.executor ?? { kind: "service", purpose: "MCP tool", provider: server } }));
    }
    const sanitized = sanitizeForObservability(call.arguments);
    this.upsert({ ...record, arguments: sanitized.value, payloadState: sanitized.state });
  }

  /** Applies a later lifecycle event; its record is created first when the
   * event arrives before ToolCallRequested. Other events are ignored. */
  private toolCallUpdated(runId: string, run: RunContext, envelope: AgentEventEnvelope, event: AgentEvent): void {
    const callId = toolCallIdOf(event);
    if (!callId) return;
    const id = toolCallRecordId(envelope.session_id, callId);
    const existing = this.snapshot.records.find((record) => record.id === id)
      ?? queuedToolCall(runId, run, envelope, { id: callId, name: "Unknown tool" });
    this.upsert({
      ...existing,
      ...envelopeMetadata(envelope),
      tokens: existing.tokens ?? runTokensSnapshot(run),
      ...toolCallChange(existing, event, iso(envelope.timestamp)),
    });
  }

  /** The observer a host tool handler receives for one call. `toolCallId`
   * is the model-facing call id (the bridge forwards it); without it the
   * call can't be matched to its record, so reports are dropped. */
  toolObserver(runId: string, sessionId: string, toolCallId: string | undefined): ToolExecutionObserver {
    if (!toolCallId) return NOOP_TOOL_EXECUTION_OBSERVER;
    const id = toolCallRecordId(sessionId, toolCallId);
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

  /** Records a call made outside any harness run (e.g. AUTO's JEV model
   * selection), already complete, as its own entry. */
  recordStandalone(record: ToolExecutionRecord): void {
    this.upsert(record);
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
    setModelTokens(run, `${role}:${model}`, tokens);
    this.trajectoryStore.setUsage(runId, `${role}:${model}`, {
      model,
      provider: source.provider ?? run.context.provider,
      role,
      ...(role === "subagent" ? { purpose: "Subagent" } : {}),
      tokens,
    });
    if (source.agentId) this.creditSubagent(runId, run, source.agentId, source);
  }

  /** A subagent's usage increment also counts toward the agent_spawn call
   * that created it. */
  private creditSubagent(runId: string, run: RunContext, agentId: string, source: UsageSource): void {
    if (source.model) run.agentModels.set(agentId, source.model);
    const spawnId = run.childSpawnCalls.get(agentId);
    const delta = definedTokens(parseUsageTokens(source.delta));
    if (spawnId && Object.keys(delta).length) {
      this.reportToolExecution(runId, spawnId, (detail) => ({ ...detail, tokens: addTokens(detail.tokens, delta) }));
    }
  }

  finishRun<K extends CapabilityName>(runId: string, outcome: RunOutcome<K>): void {
    this.trajectoryStore.finish(runId, outcome.status, outcome);
    const finishedAt = new Date().toISOString();
    let changed = false;
    const run = this.runs.get(runId);
    const records = this.snapshot.records.map((record) => {
      if (!isActiveInRun(record, runId, run?.sessionId)) return record;
      changed = true;
      return endedWithRun(record, outcome, finishedAt, runTokensSnapshot(run));
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
    this.writer.forget(id);
    this.replace(this.snapshot.records.filter((candidate) => candidate.id !== id));
    await this.persist((root) => this.persistence.delete(root, { kind: "execution", id }), [record ? rootOf(record) : undefined]);
  }

  async deleteSession(sessionId: string): Promise<void> {
    const roots = this.knownRoots(this.snapshot.records.filter((record) => record.sessionId === sessionId));
    this.trajectoryStore.remove((run) => run.sessionId === sessionId, { persist: false });
    this.writer.forgetWhere((record) => record.sessionId === sessionId);
    this.replace(this.snapshot.records.filter((record) => record.sessionId !== sessionId));
    await this.persist((root) => this.persistence.delete(root, { kind: "session", id: sessionId }), roots);
  }

  async deleteWorkspace(workspaceId: string): Promise<void> {
    this.trajectoryStore.remove((run) => run.origin.workspaceId === workspaceId, { persist: false });
    this.writer.forgetWhere((record) => record.origin.workspaceId === workspaceId);
    this.replace(this.snapshot.records.filter((record) => record.origin.workspaceId !== workspaceId));
    await this.persist((root) => this.persistence.delete(root, { kind: "all" }), [workspaceId]);
    this.trajectoryStore.repersistLive((run) => run.context?.workspaceRoot === workspaceId);
  }

  async clear(): Promise<void> {
    const roots = this.knownRoots(this.snapshot.records);
    this.trajectoryStore.remove(() => true, { persist: false });
    const kept = this.snapshot.records.filter((record) => this.runs.has(record.ideRunId) && ACTIVE_STATUSES.has(record.status));
    this.writer.forgetAll();
    this.replace(kept);
    await this.persist((root) => this.persistence.delete(root, { kind: "all" }), roots);
    this.repersistActive();
    this.snapshot = { ...this.snapshot, storageBytes: 0 };
    this.emit();
  }

  flush = async (): Promise<void> => {
    try {
      const wrote = await this.writer.write();
      if (wrote && this.snapshot.lastError) this.setError(undefined);
    } catch (error) {
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

  private repersistActive() {
    for (const record of this.snapshot.records) this.writer.queue(record);
    this.trajectoryStore.repersistLive();
    this.writer.schedule();
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
    for (const record of records) if (!previous.has(record)) this.writer.queue(record);
    this.snapshot = { ...this.snapshot, records };
    this.emit();
    this.writer.scheduleIfPending();
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
