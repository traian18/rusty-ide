import { useSyncExternalStore } from "react";
import { sanitizeForObservability } from "./redaction";
import type { ExecutionContextSnapshot, ExecutionOrigin } from "./types";

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
  sessionId?: string;
  origin: ExecutionOrigin;
  context: ExecutionContextSnapshot;
  status: "running" | "completed" | "failed" | "cancelled" | "interrupted";
  entries: TrajectoryEntry[];
  omittedEntries: number;
}
interface Snapshot { runs: RunTrajectory[]; error?: string }
const KEY = "rusty.run-trajectories.v1";
const MAX_BYTES = 2_000_000;
type EntryMetadata = Partial<Pick<TrajectoryEntry, "id" | "timestamp" | "agentId" | "sequence" | "eventCount" | "lastSequence">>;
interface PendingText {
  runId: string;
  source: string;
  messageId: string;
  delta: string;
  metadata: EntryMetadata;
}

/** Bounded local diagnostic history. Entries are append-only within the retained
 * window; pruning and payload limits are explicitly exposed in the inspector. */
export class TrajectoryStore {
  private snapshot: Snapshot = { runs: [] };
  private listeners = new Set<() => void>();
  private hydrated = false;
  private timer?: ReturnType<typeof setTimeout>;
  private streamTimer?: ReturnType<typeof setTimeout>;
  private pendingText?: PendingText;
  private retentionDays: number | null = 30;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };
  getSnapshot = (): Snapshot => {
    if (!this.hydrated) {
      this.hydrated = true;
      try {
        const saved = localStorage.getItem(KEY);
        const runs: RunTrajectory[] = saved ? JSON.parse(saved) : [];
        if (!Array.isArray(runs) || runs.some((run) => !Array.isArray(run.entries) || !run.origin || !run.context)) throw new Error("Invalid trajectory history");
        const retention = localStorage.getItem("rusty.execution-observability.retention.v1");
        this.retentionDays = retention === "unlimited" ? null : ["7", "30", "90"].includes(retention ?? "") ? Number(retention) : 30;
        const cutoff = this.retentionDays === null ? -Infinity : Date.now() - this.retentionDays * 86_400_000;
        this.snapshot = { runs: runs.filter((run) => Date.parse(run.startedAt) >= cutoff).map((run) => ({ ...run, status: run.status === "running" ? "interrupted" : run.status })) };
      } catch (error) { this.snapshot = { runs: [], error: String(error) }; }
    }
    return this.snapshot;
  };
  start(id: string, origin: ExecutionOrigin, context: ExecutionContextSnapshot) {
    this.getSnapshot();
    this.update([{ id, origin, context, startedAt: new Date().toISOString(), status: "running", entries: [], omittedEntries: 0 }, ...this.snapshot.runs]);
  }
  bind(id: string, sessionId: string) {
    this.update(this.getSnapshot().runs.map((run) => run.id === id ? { ...run, sessionId } : run));
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
    const sanitized = sanitizeForObservability(payload);
    const entry: TrajectoryEntry = { id: crypto.randomUUID(), timestamp: new Date().toISOString(), source, payload: sanitized.value, payloadState: sanitized.state, ...metadata };
    this.update(this.getSnapshot().runs.map((run) => {
      if (run.id !== id || run.entries.some((old) => old.id === entry.id)) return run;
      const entries = [...run.entries, entry];
      const omitted = Math.max(0, entries.length - 1500);
      return { ...run, entries: entries.slice(omitted), omittedEntries: run.omittedEntries + omitted };
    }));
  }
  finish(id: string, status: "completed" | "failed" | "cancelled", outcome: unknown) {
    this.append(id, "Run finished", outcome);
    this.update(this.getSnapshot().runs.map((run) => run.id === id ? { ...run, status } : run));
    this.flush();
  }
  remove(matches: (run: RunTrajectory) => boolean) {
    this.update(this.getSnapshot().runs.filter((run) => run.status === "running" || !matches(run)));
    this.flush();
  }
  setRetention(days: number | null) {
    this.retentionDays = days;
    this.remove((run) => days !== null && Date.parse(run.startedAt) < Date.now() - days * 86_400_000);
  }
  flush = () => {
    this.drainText();
    clearTimeout(this.timer);
    this.timer = undefined;
    try {
      localStorage.setItem(KEY, JSON.stringify(this.snapshot.runs));
      if (this.snapshot.error) { this.snapshot = { ...this.snapshot, error: undefined }; this.emit(); }
    } catch (error) { this.snapshot = { ...this.snapshot, error: String(error) }; this.emit(); }
  };
  private emit() { for (const listener of this.listeners) listener(); }
  private update(runs: RunTrajectory[]) {
    const cutoff = this.retentionDays === null ? -Infinity : Date.now() - this.retentionDays * 86_400_000;
    runs = runs.filter((run) => run.status === "running" || Date.parse(run.startedAt) >= cutoff).slice(0, 100);
    let size = JSON.stringify(runs).length;
    while (size > MAX_BYTES) {
      let index = runs.length - 1;
      while (index >= 0 && runs[index].entries.length === 0) index--;
      if (index < 0) break;
      const run = runs[index];
      const removed = run.entries[0];
      runs = runs.map((item, i) => i === index ? { ...item, entries: item.entries.slice(1), omittedEntries: item.omittedEntries + 1 } : item);
      size -= JSON.stringify(removed).length;
    }
    this.snapshot = { ...this.snapshot, runs };
    this.emit();
    if (!this.timer) this.timer = setTimeout(this.flush, 1000);
  }
}
export const trajectories = new TrajectoryStore();
export const useTrajectories = () => useSyncExternalStore(trajectories.subscribe, trajectories.getSnapshot, trajectories.getSnapshot);
