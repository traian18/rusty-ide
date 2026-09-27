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
interface Snapshot { runs: RunTrajectory[]; error?: string }
const LEGACY_KEY = "rusty.run-trajectories.v1";
// In-memory view budget only; every entry is also appended to disk.
const MEMORY_BYTES = 2_000_000;
const MAX_ENTRIES_IN_MEMORY = 1500;
const MAX_RUNS = 100;
/** Coalesces change notifications while a session streams: the snapshot
 * itself is always current, subscribers (React) just re-render at most
 * this often instead of once per event. */
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
/** Entry sizes are measured once and cached, so a new event costs one
 * entry's serialization instead of re-serializing every run in memory. */
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
  private snapshot: Snapshot = { runs: [] };
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
  private roots: Root[] = [undefined];
  private rootKey?: string;
  private loadToken = 0;
  private migrated = false;

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
      this.update([...unsaved, ...loaded].sort((a, b) => b.startedAt.localeCompare(a.startedAt)), false);
      this.setError(undefined);
      await this.loadEntriesWithinBudget(token);
    } catch (error) {
      this.setError(error);
    }
  }

  /** Loads a run's full trace from disk (e.g. when it is selected in the inspector). */
  async ensureEntries(id: string): Promise<void> {
    const run = this.snapshot.runs.find((item) => item.id === id);
    if (!run || this.entriesLoaded.has(id) || this.live.has(id)) return;
    this.entriesLoaded.add(id);
    try {
      const entries = await this.persistence.loadTrajectory(rootOf(run), id) as TrajectoryEntry[];
      const omitted = Math.max(0, entries.length - MAX_ENTRIES_IN_MEMORY);
      this.update(this.snapshot.runs.map((item) => item.id === id ? { ...item, entries: entries.slice(omitted), omittedEntries: omitted } : item), false);
    } catch (error) {
      this.entriesLoaded.delete(id);
      this.setError(error);
    }
  }

  private async loadEntriesWithinBudget(token: number) {
    let budget = MEMORY_BYTES - JSON.stringify(this.snapshot.runs).length;
    for (const run of this.snapshot.runs) {
      if (token !== this.loadToken || budget <= 0) return;
      if (this.live.has(run.id) || this.entriesLoaded.has(run.id)) continue;
      await this.ensureEntries(run.id);
      const loaded = this.snapshot.runs.find((item) => item.id === run.id);
      budget -= loaded ? JSON.stringify(loaded.entries).length : 0;
    }
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
        if (previous && previous.runId === id && previous.source === source &&
            previous.messageId === block.message_id && previous.metadata.agentId === metadata.agentId &&
            previous.delta.length + block.delta.length <= 8192) {
          previous.delta += block.delta;
          previous.metadata.eventCount = (previous.metadata.eventCount ?? 1) + 1;
          previous.metadata.lastSequence = metadata.sequence;
        } else {
          this.drainText();
          this.pendingText = { runId: id, source, messageId: block.message_id ?? "", delta: block.delta,
            metadata: { ...metadata, eventCount: 1, lastSequence: metadata.sequence } };
        }
        if (!this.streamTimer) this.streamTimer = setTimeout(() => this.drainText(), 250);
        return;
      }
    }
    this.drainText();
    this.appendEntry(id, source, payload, metadata);
  }
  private drainText() {
    clearTimeout(this.streamTimer);
    this.streamTimer = undefined;
    const pending = this.pendingText;
    this.pendingText = undefined;
    if (pending) this.appendEntry(pending.runId, pending.source, {
      [pending.source]: { message_id: pending.messageId, delta: pending.delta },
    }, pending.metadata);
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
  /** Replaces one model's usage within a run (e.g. the run model's running total). */
  setUsage(id: string, key: string, entry: ModelUsageEntry) {
    this.updateUsage(id, (usage) => ({ ...usage, [key]: entry }));
  }
  /** Adds an increment to one model's usage within a run (e.g. one delegated tool request). */
  addUsage(id: string, key: string, entry: Omit<ModelUsageEntry, "tokens">, delta: ExecutionTokensSnapshot) {
    this.updateUsage(id, (usage) => {
      const tokens: ExecutionTokensSnapshot = { ...usage[key]?.tokens };
      for (const field of TOKEN_FIELDS) {
        if (delta[field] !== undefined) tokens[field] = (tokens[field] ?? 0) + delta[field]!;
      }
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
  /** `persist: false` when the caller already deletes the history on disk by a wider scope. */
  remove(matches: (run: RunTrajectory) => boolean, { persist = true }: { persist?: boolean } = {}) {
    const removed = this.snapshot.runs.filter((run) => run.status !== "running" && matches(run));
    if (removed.length === 0) return;
    for (const run of removed) {
      this.dirtyRuns.delete(run.id);
      this.pendingEntries.delete(run.id);
      this.entriesLoaded.delete(run.id);
    }
    const ids = new Set(removed.map((run) => run.id));
    this.update(this.snapshot.runs.filter((run) => !ids.has(run.id)), false);
    if (persist) {
      for (const run of removed) {
        this.persistence.delete(rootOf(run), { kind: "run", id: run.id }).catch((error) => this.setError(error));
      }
    }
  }
  /** Re-queues live runs after their workspace history was wiped on disk. */
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
  private update(runs: RunTrajectory[], persist = true) {
    const cutoff = this.retentionDays === null ? -Infinity : Date.now() - this.retentionDays * 86_400_000;
    runs = runs.filter((run) => this.live.has(run.id) || Date.parse(run.startedAt) >= cutoff).slice(0, MAX_RUNS);
    let excess = runs.reduce((total, run) => total + sizeOfRun(run), 0) - MEMORY_BYTES;
    // Evict the oldest entries of the oldest runs first, one slice per run.
    for (let index = runs.length - 1; excess > 0 && index >= 0; index--) {
      const run = runs[index];
      let drop = 0;
      while (drop < run.entries.length && excess > 0) excess -= sizeOfEntry(run.entries[drop++]);
      if (drop > 0) runs = runs.map((item, i) => i === index ? { ...item, entries: item.entries.slice(drop), omittedEntries: item.omittedEntries + drop } : item);
    }
    this.snapshot = { ...this.snapshot, runs };
    this.emit();
    if (persist) this.schedule();
  }
}
export const trajectories = new TrajectoryStore();
export const useTrajectories = () => useSyncExternalStore(trajectories.subscribe, trajectories.getSnapshot, trajectories.getSnapshot);
