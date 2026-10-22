// The panel's list of runs: grouping calls and trajectories into runs
// (reusing unchanged ones), the filters, and finding the selected item.

import type { RunTrajectory } from "../../../observability/trajectoryStore";
import type { ToolExecutionRecord, ToolExecutionStatus } from "../../../observability/types";
import type { TimelineItem } from "../RunExecutionTimeline";
import { getTimestampMs } from "./format";
import { buildGroupedRun, type GroupedRun } from "./groupedRun";

interface CachedRun {
  traj?: RunTrajectory;
  records: ToolExecutionRecord[];
  run: GroupedRun;
}

export type RunCache = Map<string, CachedRun>;

export interface RunFilters {
  status: "all" | ToolExecutionStatus;
  surface: string;
  /** Lower-cased search text; empty matches everything. */
  needle: string;
}

/** Records from before run ids fall back to their session, or stand alone. */
function runKeyOf(record: ToolExecutionRecord): string {
  return record.ideRunId || (record.sessionId ? `legacy-${record.sessionId}` : `adhoc-${record.id}`);
}

function recordsByRun(records: ToolExecutionRecord[]): Map<string, ToolExecutionRecord[]> {
  const byRun = new Map<string, ToolExecutionRecord[]>();
  for (const record of records) {
    const key = runKeyOf(record);
    const group = byRun.get(key);
    if (group) group.push(record);
    else byRun.set(key, [record]);
  }
  return byRun;
}

function sameRecords(a: ToolExecutionRecord[], b: ToolExecutionRecord[]): boolean {
  return a.length === b.length && a.every((record, index) => record === b[index]);
}

function cachedOrBuilt(cached: CachedRun | undefined, runId: string, traj: RunTrajectory | undefined, records: ToolExecutionRecord[]): GroupedRun {
  const unchanged = cached && cached.traj === traj && sameRecords(cached.records, records);
  return unchanged ? cached.run : buildGroupedRun(runId, traj, records);
}

/** The runs, newest first. The stores create new objects only for what
 * changed, so a run whose trajectory and records are the same objects as
 * last time is reused from `previous`; while one session streams, only
 * that run is rebuilt. */
export function groupRuns(records: ToolExecutionRecord[], trajectories: RunTrajectory[], previous: RunCache): { runs: GroupedRun[]; cache: RunCache } {
  const byRun = recordsByRun(records);
  // Strictly match trajectory by exact id (never by loose sessionId which conflates multiple runs)
  const trajectoriesById = new Map(trajectories.map((run) => [run.id, run]));
  const cache: RunCache = new Map();
  for (const runId of new Set([...trajectoriesById.keys(), ...byRun.keys()])) {
    const traj = trajectoriesById.get(runId);
    const runRecords = byRun.get(runId) ?? [];
    cache.set(runId, { traj, records: runRecords, run: cachedOrBuilt(previous.get(runId), runId, traj, runRecords) });
  }
  const runs = [...cache.values()].map((entry) => entry.run).sort((a, b) => getTimestampMs(b.startedAt) - getTimestampMs(a.startedAt));
  return { runs, cache };
}

function hasStatus(run: GroupedRun, status: ToolExecutionStatus): boolean {
  return run.status === status || run.records.some((record) => record.status === status);
}

function recordText(record: ToolExecutionRecord): string {
  return `${record.toolName} ${record.resultPreview ?? ""} ${JSON.stringify(record.arguments)}`.toLowerCase();
}

function itemText(item: TimelineItem): string {
  return item.kind === "tool" ? "" : item.text.toLowerCase();
}

/** The run's prompt, model, source, capability, calls or streamed text contain the needle. */
function runMentions(run: GroupedRun, needle: string): boolean {
  const fields = [run.requestPrompt, run.model, run.originLabel, run.capability];
  if (fields.some((field) => field?.toLowerCase().includes(needle))) return true;
  return run.records.some((record) => recordText(record).includes(needle))
    || run.timelineItems.some((item) => itemText(item).includes(needle));
}

export function runMatches(run: GroupedRun, { status, surface, needle }: RunFilters): boolean {
  if (status !== "all" && !hasStatus(run, status)) return false;
  if (surface !== "all" && run.surface !== surface) return false;
  return !needle || runMentions(run, needle);
}

export function findSelected(runs: GroupedRun[], itemId: string | null): { run: GroupedRun; item: TimelineItem } | null {
  if (!itemId) return null;
  for (const run of runs) {
    const item = run.timelineItems.find((candidate) => candidate.id === itemId);
    if (item) return { run, item };
  }
  return null;
}
