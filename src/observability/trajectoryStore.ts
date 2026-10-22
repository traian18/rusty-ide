import { useSyncExternalStore } from "react";
import { defaultPersistence, readRetentionPreference, sinceDayFor, takeLegacyItem, type ObservabilityPersistence } from "./persistence";
import { sanitizeForObservability } from "./redaction";
import { TrajectoryMemoryBudget } from "./trajectoryMemory";
import type { ExecutionContextSnapshot, ExecutionOrigin, ExecutionTokensSnapshot, ModelUsageEntry, RunUsage } from "./types";
import { addTokens } from "./usageTokens";

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
const MAX_ENTRIES_IN_MEMORY = 1500;
const MAX_RUNS = 100;
const NOTIFY_INTERVAL_MS = 120;
/** Streamed text events coalesced into one entry, up to this many characters. */
const STREAMED_TEXT_SOURCES = new Set(["AssistantTextDelta", "ReasoningDelta"]);
const MAX_COALESCED_TEXT = 8192;
/** A model request is redacted whole, then stored in chunks of this many characters. */
const REQUEST_CHUNK_CHARS = 12000;

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

/** A run saved while still running was cut off when the IDE closed. */
function settledStatus(status: RunTrajectory["status"]): RunTrajectory["status"] {
  return status === "running" ? "interrupted" : status;
}

/** A saved run the view can show: it carries its origin and context. */
function isRestorableRun(run: RunTrajectory | null | undefined): run is RunTrajectory {
  return Boolean(run?.id && run.origin && run.context);
}

/** The runs in a legacy localStorage value, or undefined when it is not JSON. */
function parseLegacyRuns(raw: string): RunTrajectory[] | undefined {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return undefined;
  }
}

type TextBlock = { message_id?: string; delta: string };

/** A streamed text delta's block, when the payload carries one. */
function textDelta(source: string, payload: unknown): TextBlock | undefined {
  if (!STREAMED_TEXT_SOURCES.has(source)) return undefined;
  const block = (payload as Record<string, { message_id?: string; delta?: string }> | null)?.[source];
  return typeof block?.delta === "string" ? (block as TextBlock) : undefined;
}

/** Whether a delta belongs to the pending text: same run, stream, message and agent. */
function continuesText(pending: PendingText, next: { runId: string; source: string; messageId?: string; agentId?: string }): boolean {
  const sameStream = pending.runId === next.runId && pending.source === next.source;
  return sameStream && pending.messageId === next.messageId && pending.metadata.agentId === next.agentId;
}

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
  private memory = new TrajectoryMemoryBudget();

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
      const unsaved = this.snapshot.runs.filter((run) => this.hasUnsavedWork(run.id) || !loadedRoots.has(rootOf(run)));
      const unsavedIds = new Set(unsaved.map((run) => run.id));
      const loaded: RunTrajectory[] = [];
      for (const raw of results.flatMap((result) => result.trajectories as RunTrajectory[])) {
        if (unsavedIds.has(raw.id) || !raw.origin || !raw.context) continue;
        const kept = inMemory.get(raw.id);
        loaded.push(kept ?? { ...raw, status: settledStatus(raw.status), entries: [], omittedEntries: 0 });
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
    if (!run || this.entriesAvailable(id)) return;
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

  /** A live run, or one with entries still to be written to disk. */
  private hasUnsavedWork(id: string): boolean {
    return this.live.has(id) || this.dirtyRuns.has(id) || this.pendingEntries.has(id);
  }

  /** The run's entries are in memory already, being loaded, or being written live. */
  private entriesAvailable(id: string): boolean {
    return this.entriesLoaded.has(id) || this.loadingEntries.has(id) || this.live.has(id);
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
    const runs = parseLegacyRuns(legacy.raw);
    if (!runs) {
      legacy.remove();
      return;
    }
    try {
      for (const run of runs.filter(isRestorableRun)) await this.migrateLegacyRun(run);
      legacy.remove();
    } catch (error) {
      this.setError(error);
    }
  }

  private async migrateLegacyRun(run: RunTrajectory) {
    const root = rootOf(run);
    await this.persistence.append(root, "trajectory-index", [{ ...indexLine({ ...run, entries: [], omittedEntries: 0 }), status: settledStatus(run.status) }]);
    if (Array.isArray(run.entries) && run.entries.length) await this.persistence.append(root, "trajectory-entries", run.entries, run.id);
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
    const block = textDelta(source, payload);
    if (block) {
      this.appendTextDelta(id, source, block, metadata);
      return;
    }
    this.drainText();
    if (source === "ModelRequestPrepared") {
      this.appendModelRequest(id, payload, metadata);
      return;
    }
    this.appendEntry(id, source, payload, metadata);
  }
  /** Coalesces consecutive deltas of one message into a single entry, written on a pause. */
  private appendTextDelta(id: string, source: string, block: TextBlock, metadata: EntryMetadata) {
    const previous = this.pendingText;
    const next = { runId: id, source, messageId: block.message_id, agentId: metadata.agentId };
    if (previous && continuesText(previous, next) && previous.delta.length + block.delta.length <= MAX_COALESCED_TEXT) {
      previous.delta += block.delta;
      previous.metadata.eventCount = (previous.metadata.eventCount ?? 1) + 1;
      previous.metadata.lastSequence = metadata.sequence;
    } else {
      this.drainText();
      this.pendingText = { runId: id, source, messageId: block.message_id ?? "", delta: block.delta, metadata: { ...metadata, eventCount: 1, lastSequence: metadata.sequence } };
    }
    if (!this.streamTimer) this.streamTimer = setTimeout(() => this.drainText(), 250);
  }
  private appendModelRequest(id: string, payload: unknown, metadata: EntryMetadata) {
    // Redact the whole request BEFORE splitting so a credential cannot leak
    // across chunk boundaries. Ordinary event previews keep their size caps.
    const sanitized = sanitizeForObservability(payload, true);
    const serialized = JSON.stringify(sanitized.value);
    const traceId = crypto.randomUUID();
    const parts = Math.ceil(serialized.length / REQUEST_CHUNK_CHARS);
    for (let part = 0; part < parts; part++) {
      this.appendEntry(id, "ModelRequestPrepared", {
        traceId, part: part + 1, parts, encoding: "json", state: sanitized.state,
        content: serialized.slice(part * REQUEST_CHUNK_CHARS, (part + 1) * REQUEST_CHUNK_CHARS),
      }, { ...metadata, id: `${traceId}:${part}` });
    }
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
    this.updateUsage(id, (usage) => ({ ...usage, [key]: { ...usage[key], ...entry, tokens: addTokens(usage[key]?.tokens, delta) } }));
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
    const index = this.dirtyIndexLines();
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
      this.requeue(dirty, pending);
      this.setError(error);
    }
  };
  /** The index lines of the changed runs, grouped by workspace. */
  private dirtyIndexLines(): Map<Root, unknown[]> {
    const runs = new Map(this.snapshot.runs.map((run) => [run.id, run]));
    const index = new Map<Root, unknown[]>();
    for (const id of this.dirtyRuns) {
      const run = runs.get(id);
      if (!run) continue;
      const root = rootOf(run);
      index.set(root, [...(index.get(root) ?? []), indexLine(run)]);
    }
    return index;
  }
  /** Puts a failed batch back ahead of anything queued since, for the next flush. */
  private requeue(dirty: Set<string>, pending: Map<string, { root: Root; entries: TrajectoryEntry[] }>) {
    for (const id of dirty) this.dirtyRuns.add(id);
    for (const [id, batch] of pending) {
      const newer = this.pendingEntries.get(id);
      this.pendingEntries.set(id, { root: batch.root, entries: [...batch.entries, ...(newer?.entries ?? [])] });
    }
  }
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
    this.snapshot = { ...this.snapshot, runs: this.memory.fit(this.retained(runs), recalculate) };
    this.emit();
    if (persist) this.schedule();
  }
  /** Live runs, and the newest saved ones inside the retention window. */
  private retained(runs: RunTrajectory[]): RunTrajectory[] {
    const cutoff = this.retentionDays === null ? -Infinity : Date.now() - this.retentionDays * 86_400_000;
    return runs.filter((run) => this.live.has(run.id) || Date.parse(run.startedAt) >= cutoff).slice(0, MAX_RUNS);
  }
}
export const trajectories = new TrajectoryStore();
export const useTrajectories = () => useSyncExternalStore(trajectories.subscribe, trajectories.getSnapshot, trajectories.getSnapshot);
