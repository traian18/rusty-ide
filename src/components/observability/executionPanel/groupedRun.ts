// One execution run as the panel shows it: its tool calls (from the
// execution store) and streamed text (from its trajectory) on one
// timeline, with the run's status, origin and token usage worked out.

import type { RunTrajectory, TrajectoryEntry } from "../../../observability/trajectoryStore";
import { ACTIVE_STATUSES } from "../../../observability/toolCallRecords";
import type { ExecutionTokensSnapshot, ModelUsageEntry, RunUsage, ToolExecutionRecord } from "../../../observability/types";
import type { TimelineItem } from "../RunExecutionTimeline";
import { getTimestampMs } from "./format";

export type TimelineToolItem = Extract<TimelineItem, { kind: "tool" }>;
export type TimelineAssistantTextItem = Extract<TimelineItem, { kind: "assistant_text" }>;
export type TimelineReasoningItem = Extract<TimelineItem, { kind: "reasoning" }>;
export type TimelineTextItem = TimelineAssistantTextItem | TimelineReasoningItem;

export interface GroupedRun {
  runId: string;
  sessionId?: string;
  status: "running" | "succeeded" | "failed" | "cancelled";
  startedAt: string;
  finishedAt?: string;
  durationMs?: number;
  originLabel: string;
  surface: string;
  capability?: string;
  model?: string;
  provider?: string;
  requestPrompt?: string;
  totalTokens?: number;
  runTokens?: ExecutionTokensSnapshot;
  usage?: RunUsage;
  records: ToolExecutionRecord[];
  timelineItems: TimelineItem[];
  entries: TrajectoryEntry[];
}

/** Each streamed text the trajectory records becomes its own timeline item
 * kind; trajectoryStore.ts coalesces both sources the same way. */
const STREAMED_TEXT_KINDS: Array<{ kind: TimelineTextItem["kind"]; source: string; idPrefix: string }> = [
  { kind: "assistant_text", source: "AssistantTextDelta", idPrefix: "text" },
  { kind: "reasoning", source: "ReasoningDelta", idPrefix: "reasoning" },
];

export const USAGE_COLUMNS: { key: keyof ExecutionTokensSnapshot; label: string }[] = [
  { key: "inputTokens", label: "Input" },
  { key: "outputTokens", label: "Output" },
  { key: "cacheReadTokens", label: "Cache read" },
  { key: "cacheWriteTokens", label: "Cache write" },
  { key: "reasoningTokens", label: "Reasoning" },
  { key: "totalTokens", label: "Total" },
];

export function sumUsage(entries: ModelUsageEntry[]): ExecutionTokensSnapshot {
  const total: ExecutionTokensSnapshot = {};
  for (const entry of entries) {
    for (const { key } of USAGE_COLUMNS) {
      const value = entry.tokens[key];
      if (value !== undefined) total[key] = (total[key] ?? 0) + value;
    }
  }
  return total;
}

/** Every model's tokens in the run, including models tools delegated to. */
export function runUsageTotal(usage: RunUsage | undefined): ExecutionTokensSnapshot | undefined {
  const entries = Object.values(usage ?? {});
  return entries.length ? sumUsage(entries) : undefined;
}

const startOf = (record: ToolExecutionRecord) => record.startedAt || record.requestedAt;

function sortByStart(records: ToolExecutionRecord[]): ToolExecutionRecord[] {
  return [...records].sort((a, b) => getTimestampMs(startOf(a)) - getTimestampMs(startOf(b)));
}

/** A call still active in a finished run never got a terminal event (the
 * process ended): it is shown closed with the run's outcome. */
function closedWithRun(record: ToolExecutionRecord, traj: RunTrajectory): ToolExecutionRecord {
  const finishedAt = traj.finishedAt || record.finishedAt || new Date().toISOString();
  return {
    ...record,
    status: traj.status === "cancelled" ? "cancelled" : "failed",
    finishedAt,
    durationMs: record.durationMs ?? (record.startedAt ? Math.max(0, getTimestampMs(finishedAt) - getTimestampMs(record.startedAt)) : undefined),
    resultPreview: record.resultPreview ?? "Process ended before a terminal tool event was recorded.",
  };
}

function settleRecords(records: ToolExecutionRecord[], traj: RunTrajectory | undefined): ToolExecutionRecord[] {
  if (!traj || traj.status === "running") return records;
  return records.map((record) => (ACTIVE_STATUSES.has(record.status) ? closedWithRun(record, traj) : record));
}

const allCancelled = (records: ToolExecutionRecord[]) => records.length > 0 && records.every((r) => r.status === "cancelled");

/** Running wins over failed, failed over cancelled; otherwise it succeeded. */
function runStatus(records: ToolExecutionRecord[], traj: RunTrajectory | undefined): GroupedRun["status"] {
  if (records.some((r) => ACTIVE_STATUSES.has(r.status)) || traj?.status === "running") return "running";
  if (records.some((r) => r.status === "failed") || traj?.status === "failed") return "failed";
  if (allCancelled(records) || traj?.status === "cancelled") return "cancelled";
  return "succeeded";
}

function runStartedAt(traj: RunTrajectory | undefined, first: ToolExecutionRecord | undefined): string {
  const recorded = traj?.startedAt || first?.startedAt;
  return recorded || first?.requestedAt || new Date().toISOString();
}

function elapsed(startedAt: string, finishedAt: string | undefined): number | undefined {
  return startedAt && finishedAt ? Math.max(0, getTimestampMs(finishedAt) - getTimestampMs(startedAt)) : undefined;
}

/** Runs recorded before per-model tracking: the largest token snapshot on their records. */
function largestRecordTokens(records: ToolExecutionRecord[]): ExecutionTokensSnapshot | undefined {
  return records.reduce<ExecutionTokensSnapshot | undefined>((acc, r) => {
    if (!r.tokens?.totalTokens) return acc;
    return !acc || r.tokens.totalTokens > (acc.totalTokens ?? 0) ? r.tokens : acc;
  }, undefined);
}

/** Where the run came from: its trajectory, else its first call. */
function runOrigin(traj: RunTrajectory | undefined, first: ToolExecutionRecord | undefined) {
  return {
    originLabel: traj?.origin?.displayLabel || first?.origin?.displayLabel || "Execution",
    surface: traj?.origin?.surface || first?.origin?.surface || "agent",
    capability: traj?.context?.capability || first?.context?.capability,
    model: traj?.context?.model || first?.context?.model,
    provider: traj?.context?.provider || first?.context?.provider,
  };
}

function deltaText(block: any): string {
  if (typeof block?.delta === "string") return block.delta;
  return typeof block?.text === "string" ? block.text : "";
}

function streamedTextItems(entries: TrajectoryEntry[], stream: (typeof STREAMED_TEXT_KINDS)[number]): TimelineTextItem[] {
  const items: TimelineTextItem[] = [];
  for (const entry of entries.filter((candidate) => candidate.source === stream.source)) {
    const payload = entry.payload as Record<string, any> | undefined;
    const block = payload?.[stream.source] ?? payload;
    const text = deltaText(block);
    if (!text.trim()) continue;
    items.push({
      kind: stream.kind,
      id: `${stream.idPrefix}-${entry.id}`,
      timestamp: entry.timestamp,
      messageId: String(block?.message_id ?? entry.id),
      text,
      agentId: entry.agentId,
    });
  }
  return items;
}

/** Tool calls and streamed text in time order. */
function timelineItems(records: ToolExecutionRecord[], entries: TrajectoryEntry[]): TimelineItem[] {
  const toolItems: TimelineToolItem[] = records.map((record) => ({ kind: "tool", id: record.id, timestamp: startOf(record), record }));
  const textItems = STREAMED_TEXT_KINDS.flatMap((stream) => streamedTextItems(entries, stream));
  return [...toolItems, ...textItems].sort((a, b) => getTimestampMs(a.timestamp) - getTimestampMs(b.timestamp));
}

/** Builds one run's view model. Pure, so the panel can cache it per run
 * and rebuild only runs whose trajectory or records actually changed. */
export function buildGroupedRun(runId: string, traj: RunTrajectory | undefined, records: ToolExecutionRecord[]): GroupedRun {
  const settled = settleRecords(sortByStart(records), traj);
  const first = settled[0];
  const startedAt = runStartedAt(traj, first);
  const finishedAt = traj?.finishedAt || settled[settled.length - 1]?.finishedAt;
  // Per-model usage recorded on the run, else the older single total.
  const runTokens = runUsageTotal(traj?.usage) ?? largestRecordTokens(settled);
  const entries = traj?.entries ?? [];
  return {
    runId,
    sessionId: traj?.sessionId || first?.sessionId,
    status: runStatus(settled, traj),
    startedAt,
    finishedAt,
    durationMs: elapsed(startedAt, finishedAt),
    ...runOrigin(traj, first),
    requestPrompt: traj?.context?.requestPrompt || settled.find((r) => r.context?.requestPrompt)?.context?.requestPrompt,
    totalTokens: runTokens?.totalTokens,
    runTokens,
    usage: traj?.usage,
    records: settled,
    timelineItems: timelineItems(settled, entries),
    entries,
  };
}
