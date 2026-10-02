import { useSyncExternalStore } from "react";
import { defaultPersistence, readRetentionPreference, sinceDayFor, takeLegacyItem, type ObservabilityPersistence } from "./persistence";
import { sanitizeForObservability } from "./redaction";
import type { ExecutionContextSnapshot, ExecutionOrigin, ExecutionTokensSnapshot, ModelUsageEntry, RunUsage } from "./types";

export interface TrajectoryEntry {
  id: string;
  timestamp: string;
  source: string;
  agentId?: string;
  sequence?: number;
  eventCount?: number;
  lastSequence?: number;
  payload: unknown;
  payloadState: "full" | "redacted" | "truncated";
}
export interface RunTrajectory {
  id: string;
  startedAt: string;
  finishedAt?: string;
  sessionId?: string;
  origin: ExecutionOrigin;
  context: ExecutionContextSnapshot;
  status: "running" | "completed" | "failed" | "cancelled" | "interrupted";
  entries: TrajectoryEntry[];
  omittedEntries: number;
  /** Tokens per model: the run's own model(s) and any model a tool delegated to. */
  usage?: RunUsage;
}
interface Snapshot {
  runs: RunTrajectory[];
  error?: string;
  loadingEntries: ReadonlySet<string>;
  entryErrors: ReadonlyMap<string, string>;
}
const LEGACY_KEY = "rusty.run-trajectories.v1";
// Approximate in-memory guard. JSON string lengths are cached per immutable
// entry; metadata gets a small fixed allowance per run.
const MEMORY_BYTES = 2_000_000;
const MAX_ENTRIES_IN_MEMORY = 1500;
const MAX_RUNS = 100;
const NOTIFY_INTERVAL_MS = 120;
const TOKEN_FIELDS = ["totalTokens", "inputTokens", "outputTokens", "cacheReadTokens", "cacheWriteTokens", "reasoningTokens"] as const;

const entryBytes = new WeakMap<TrajectoryEntry, number>();
const runBytes = new WeakMap<RunTrajectory, number>();
function sizeOfEntry(entry: TrajectoryEntry): number {
  let size = entryBytes.get(entry);
  if (size === undefined) {
    size = JSON.stringify(entry).length;
    entryBytes.set(entry, size);
  }
  return size;
}
function sizeOfRun(run: RunTrajectory): number {
  let size = runBytes.get(run);
  if (size === undefined) {
    size = 512 + run.entries.reduce((total, entry) => total + sizeOfEntry(entry), 0);
    runBytes.set(run, size);
  }
  return size;
}
type EntryMetadata = Partial<Pick<TrajectoryEntry, "id" | "timestamp" | "agentId" | "sequence" | "eventCount" | "lastSequence">>;
interface PendingText {
  runId: string;
  source: string;
  messageId: string;
  delta: string;
  metadata: EntryMetadata;
}
type Root = string | undefined;

const rootOf = (run: Pick<RunTrajectory, "context">): Root => run.context?.workspaceRoot || undefined;
const indexLine = ({ entries: _entries, omittedEntries: _omitted, ...meta }: RunTrajectory) => meta;

export class TrajectoryStore {
  private snapshot: Snapshot = { runs: [], loadingEntries: new Set(), entryErrors: new Map() };
  private listeners = new Set<() => void>();
  private timer?: ReturnType<typeof setTimeout>;
  private notifyTimer?: ReturnType<typeof setTimeout>;
  private streamTimer?: ReturnType<typeof setTimeout>;
  private pendingText?: PendingText;
  private retentionDays: number | null = readRetentionPreference();
  private live = new Set<string>();
  private dirtyRuns = new Set<string>();
  private pendingEntries = new Map<string, { root: Root; entries: TrajectoryEntry[] }>();
  private entriesLoaded = new Set<string>();
  private loadingEntries = new Set<string>();
  private entryErrors = new Map<string, string>();
  private roots: Root[] = [undefined];
  private rootKey?: string;
  private loadToken = 0;
  private migrated = false;
  private totalBytes = 0;
  private accountedRuns = new Map<string, RunTrajectory>();

  constructor(private persistence: ObservabilityPersistence = defaultPersistence()) {}

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };
  getSnapshot = (): Snapshot => this.snapshot;

  async setWorkspace(root: Root): Promise<void> {
    const key = root ?? "";
    if (this.rootKey === key) return;
    this.rootKey = key;
    this.roots = root ? [root, undefined] : [undefined];
    await this.load();
  }

  async load(): Promise<void> {
    const token = ++this.loadToken;
    await this.migrateLegacy();
    try {
      const sinceDay = sinceDayFor(this.retentionDays);
      const results = await Promise.all(this.roots.map((root) =>
        this.persistence.load(root, { sinceDay, limit: 0, trajectoryLimit: MAX_RUNS })));
      if (token !== this.loadToken) return;
      const inMemory = new Map(this.snapshot.runs.map((run) => [run.id, run]));
      const loadedRoots = new Set(this.roots);
      const unsaved = this.snapshot.runs.filter((run) =>
        this.live.has(run.id) || this.dirtyRuns.has(run.id) || this.pendingEntries.has(run.id) || !loadedRoots.has(rootOf(run)));
      const unsavedIds = new Set(unsaved.map((run) => run.id));
      const loaded: RunTrajectory[] = [];
      for (const raw of results.flatMap((result) => result.trajectories as RunTrajectory[])) {
        if (unsavedIds.has(raw.id) || !raw.origin || !raw.context) continue;
        const kept = inMemory.get(raw.id);
        loaded.push(kept ?? { ...raw, status: raw.status === "running" ? "interrupted" : raw.status, entries: [], omittedEntries: 0 });
      }
      this.update([...unsaved, ...loaded].sort((a, b) => b.startedAt.localeCompare(a.startedAt)), false, true);
      this.setError(undefined);
    } catch (error) {
      this.setError(error);
    }
  }

  /** Demand-loads a historical run once. Concurrent calls share the same in-flight state. */
  async ensureEntries(id: string): Promise<void> {
    const run = this.snapshot.runs.find((item) => item.id === id);
    if (!run || this.entriesLoaded.has(id) || this.loadingEntries.has(id) || this.live.has(id)) return;
    this.loadingEntries.add(id);
    this.entryErrors.delete(id);
    this.publishEntryState();
    try {
      const entries = await this.persistence.loadTrajectory(rootOf(run), id) as TrajectoryEntry[];
      const omitted = Math.max(0, entries.length - MAX_ENTRIES_IN_MEMORY);
      this.entriesLoaded.add(id);
      this.update(this.snapshot.runs.map((item) => item.id === id ? { ...item, entries: entries.slice(omitted), omittedEntries: omitted } : item), false);
    } catch (error) {
      this.entryErrors.set(id, error instanceof Error ? error.message : String(error));
      this.setError(error);
    } finally {
      this.loadingEntries.delete(id);
      this.publishEntryState();
    }
  }

  private publishEntryState() {
    this.snapshot = { ...this.snapshot, loadingEntries: new Set(this.loadingEntries), entryErrors: new Map(this.entryErrors) };
    this.emit();
  }

  private async migrateLegacy() {
    if (this.migrated) return;
    this.migrated = true;
    const legacy = takeLegacyItem(LEGACY_KEY);
    if (!legacy) return;
    let runs: RunTrajectory[];
    try {
      const parsed = JSON.parse(legacy.raw);
      runs = Array.isArray(parsed) ? parsed : [];
    } catch {
      legacy.remove();
      return;
    }
    try {
      for (const run of runs) {
        if (!run?.id || !run.origin || !run.context) continue;
        const root = rootOf(run);
        await this.persistence.append(root, "trajectory-index", [{ ...indexLine({ ...run, entries: [], omittedEntries: 0 }), status: run.status === "running" ? "interrupted" : run.status }]);
        if (Array.isArray(run.entries) && run.entries.length) await this.persistence.append(root, "trajectory-entries", run.entries, run.id);
      }
      legacy.remove();
    } catch (error) {
      this.setError(error);
    }
  }

  start(id: string, origin: ExecutionOrigin, context: ExecutionContextSnapshot) {
    this.live.add(id);
    this.entriesLoaded.add(id);
    this.dirtyRuns.add(id);
    this.update([{ id, origin, context, startedAt: new Date().toISOString(), status: "running", entries: [], omittedEntries: 0 }, ...this.snapshot.runs]);
  }
  bind(id: string, sessionId: string) {
    this.dirtyRuns.add(id);
    this.update(this.snapshot.runs.map((run) => run.id === id ? { ...run, sessionId } : run));
  }
  append(id: string, source: string, payload: unknown, metadata: EntryMetadata = {}) {
    if (source === "AssistantTextDelta" || source === "ReasoningDelta") {
      const block = (payload as Record<string, { message_id?: string; delta?: string }> | null)?.[source];
      if (typeof block?.delta === "string") {
        const previous = this.pendingText;
        if (previous && previous.runId === id && previous.source === source && previous.messageId === block.message_id && previous.metadata.agentId === metadata.agentId && previous.delta.length + block.delta.length <= 8192) {
          previous.delta += block.delta;
          previous.metadata.eventCount = (previous.metadata.eventCount ?? 1) + 1;
          previous.metadata.lastSequence = metadata.sequence;
        } else {
          this.drainText();
          this.pendingText = { runId: id, source, messageId: block.message_id ?? "", delta: block.delta, metadata: { ...metadata, eventCount: 1, lastSequence: metadata.sequence } };
        }
        if (!this.streamTimer) this.streamTimer = setTimeout(() => this.drainText(), 250);
        return;
      }
    }
    this.drainText();
    if (source === "ModelRequestPrepared") {
      // Redact the whole request BEFORE splitting so a credential cannot leak
      // across chunk boundaries. Ordinary event previews keep their size caps.
      const sanitized = sanitizeForObservability(payload, true);
      const serialized = JSON.stringify(sanitized.value);
      const traceId = crypto.randomUUID();
      const parts = Math.ceil(serialized.length / 12000);
      for (let part = 0; part < parts; part++) {
        this.appendEntry(id, source, {
          traceId, part: part + 1, parts, encoding: "json", state: sanitized.state,
          content: serialized.slice(part * 12000, (part + 1) * 12000),
        }, { ...metadata, id: `${traceId}:${part}` });
      }
      return;
    }
    this.appendEntry(id, source, payload, metadata);
  }
  private drainText() {
    clearTimeout(this.streamTimer);
    this.streamTimer = undefined;
    const pending = this.pendingText;
    this.pendingText = undefined;
    if (pending) this.appendEntry(pending.runId, pending.source, { [pending.source]: { message_id: pending.messageId, delta: pending.delta } }, pending.metadata);
  }
  private appendEntry(id: string, source: string, payload: unknown, metadata: EntryMetadata) {
    const run = this.snapshot.runs.find((item) => item.id === id);
    if (!run) return;
    const sanitized = sanitizeForObservability(payload);
    const entry: TrajectoryEntry = { id: crypto.randomUUID(), timestamp: new Date().toISOString(), source, payload: sanitized.value, payloadState: sanitized.state, ...metadata };
    if (run.entries.some((old) => old.id === entry.id)) return;
    const pending = this.pendingEntries.get(id) ?? { root: rootOf(run), entries: [] };
    pending.entries.push(entry);
    this.pendingEntries.set(id, pending);
    this.update(this.snapshot.runs.map((item) => {
      if (item.id !== id) return item;
      const entries = [...item.entries, entry];
      const omitted = Math.max(0, entries.length - MAX_ENTRIES_IN_MEMORY);
      return { ...item, entries: entries.slice(omitted), omittedEntries: item.omittedEntries + omitted };
    }));
  }
  setUsage(id: string, key: string, entry: ModelUsageEntry) {
    this.updateUsage(id, (usage) => ({ ...usage, [key]: entry }));
  }
  addUsage(id: string, key: string, entry: Omit<ModelUsageEntry, "tokens">, delta: ExecutionTokensSnapshot) {
    this.updateUsage(id, (usage) => {
      const tokens: ExecutionTokensSnapshot = { ...usage[key]?.tokens };
      for (const field of TOKEN_FIELDS) if (delta[field] !== undefined) tokens[field] = (tokens[field] ?? 0) + delta[field]!;
      return { ...usage, [key]: { ...usage[key], ...entry, tokens } };
    });
  }
  private updateUsage(id: string, change: (usage: RunUsage) => RunUsage) {
    const run = this.snapshot.runs.find((item) => item.id === id);
    if (!run) return;
    this.dirtyRuns.add(id);
    const usage = change(run.usage ?? {});
    this.update(this.snapshot.runs.map((item) => item.id === id ? { ...item, usage } : item));
  }
  finish(id: string, status: "completed" | "failed" | "cancelled", outcome: unknown) {
    this.append(id, "Run finished", outcome);
    const finishedAt = new Date().toISOString();
    this.live.delete(id);
    this.dirtyRuns.add(id);
    this.update(this.snapshot.runs.map((run) => run.id === id ? { ...run, status, finishedAt } : run));
    void this.flush();
  }
  remove(matches: (run: RunTrajectory) => boolean, { persist = true }: { persist?: boolean } = {}) {
    const removed = this.snapshot.runs.filter((run) => run.status !== "running" && matches(run));
    if (removed.length === 0) return;
    for (const run of removed) {
      this.dirtyRuns.delete(run.id);
      this.pendingEntries.delete(run.id);
      this.entriesLoaded.delete(run.id);
      this.loadingEntries.delete(run.id);
      this.entryErrors.delete(run.id);
    }
    const ids = new Set(removed.map((run) => run.id));
    this.update(this.snapshot.runs.filter((run) => !ids.has(run.id)), false);
    if (persist) for (const run of removed) this.persistence.delete(rootOf(run), { kind: "run", id: run.id }).catch((error) => this.setError(error));
  }
  repersistLive(matches: (run: RunTrajectory) => boolean = () => true) {
    for (const run of this.snapshot.runs) {
      if (!this.live.has(run.id) || !matches(run)) continue;
      this.dirtyRuns.add(run.id);
      this.pendingEntries.set(run.id, { root: rootOf(run), entries: [...run.entries] });
    }
    this.schedule();
  }
  async setRetention(days: number | null): Promise<void> {
    this.retentionDays = days;
    await this.load();
  }
  flush = async (): Promise<void> => {
    this.drainText();
    clearTimeout(this.timer);
    this.timer = undefined;
    const runs = new Map(this.snapshot.runs.map((run) => [run.id, run]));
    const index = new Map<Root, unknown[]>();
    for (const id of this.dirtyRuns) {
      const run = runs.get(id);
      if (!run) continue;
      const root = rootOf(run);
      index.set(root, [...(index.get(root) ?? []), indexLine(run)]);
    }
    const dirty = this.dirtyRuns;
    const pending = this.pendingEntries;
    this.dirtyRuns = new Set();
    this.pendingEntries = new Map();
    if (index.size === 0 && pending.size === 0) return;
    try {
      for (const [root, lines] of index) await this.persistence.append(root, "trajectory-index", lines);
      for (const [id, { root, entries }] of pending) await this.persistence.append(root, "trajectory-entries", entries, id);
      this.setError(undefined);
    } catch (error) {
      for (const id of dirty) this.dirtyRuns.add(id);
      for (const [id, batch] of pending) {
        const newer = this.pendingEntries.get(id);
        this.pendingEntries.set(id, { root: batch.root, entries: [...batch.entries, ...(newer?.entries ?? [])] });
      }
      this.setError(error);
    }
  };
  private schedule() {
    if (!this.timer) this.timer = setTimeout(() => void this.flush(), 1000);
  }
  private setError(error: unknown) {
    const message = error === undefined ? undefined : error instanceof Error ? error.message : String(error);
    if (message === this.snapshot.error) return;
    this.snapshot = { ...this.snapshot, error: message };
    this.emit();
  }
  private emit() {
    if (this.notifyTimer) return;
    this.notifyTimer = setTimeout(() => {
      this.notifyTimer = undefined;
      for (const listener of this.listeners) listener();
    }, NOTIFY_INTERVAL_MS);
  }
  private update(runs: RunTrajectory[], persist = true, recalculate = false) {
    const cutoff = this.retentionDays === null ? -Infinity : Date.now() - this.retentionDays * 86_400_000;
    runs = runs.filter((run) => this.live.has(run.id) || Date.parse(run.startedAt) >= cutoff).slice(0, MAX_RUNS);

    if (recalculate || this.accountedRuns.size === 0) {
      this.totalBytes = runs.reduce((total, run) => total + sizeOfRun(run), 0);
    } else {
      const nextIds = new Set(runs.map((run) => run.id));
      for (const [id, previous] of this.accountedRuns) if (!nextIds.has(id)) this.totalBytes -= sizeOfRun(previous);
      for (const run of runs) {
        const previous = this.accountedRuns.get(run.id);
        if (previous !== run) this.totalBytes += sizeOfRun(run) - (previous ? sizeOfRun(previous) : 0);
      }
    }

    // Only enter eviction work when the tracked total crosses the budget.
    for (let index = runs.length - 1; this.totalBytes > MEMORY_BYTES && index >= 0; index--) {
      const run = runs[index];
      let drop = 0;
      while (drop < run.entries.length && this.totalBytes > MEMORY_BYTES) this.totalBytes -= sizeOfEntry(run.entries[drop++]);
      if (drop > 0) runs = runs.map((item, i) => i === index ? { ...item, entries: item.entries.slice(drop), omittedEntries: item.omittedEntries + drop } : item);
    }
    this.accountedRuns = new Map(runs.map((run) => [run.id, run]));
    this.snapshot = { ...this.snapshot, runs };
    this.emit();
    if (persist) this.schedule();
  }
}
export const trajectories = new TrajectoryStore();
export const useTrajectories = () => useSyncExternalStore(trajectories.subscribe, trajectories.getSnapshot, trajectories.getSnapshot);
