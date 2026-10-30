import type { RunTrajectory, TrajectoryEntry } from "./trajectoryStore";

export const LEGACY_KEY = "rusty.run-trajectories.v1";
export const MAX_ENTRIES_IN_MEMORY = 1500;
export const MAX_RUNS = 100;
export const NOTIFY_INTERVAL_MS = 120;
/** Streamed text events coalesced into one entry, up to this many characters. */
export const STREAMED_TEXT_SOURCES = new Set(["AssistantTextDelta", "ReasoningDelta"]);
export const MAX_COALESCED_TEXT = 8192;
/** A model request is redacted whole, then stored in chunks of this many characters. */
export const REQUEST_CHUNK_CHARS = 12000;

export type EntryMetadata = Partial<Pick<TrajectoryEntry, "id" | "timestamp" | "agentId" | "sequence" | "eventCount" | "lastSequence">>;
export interface PendingText {
  runId: string;
  source: string;
  messageId: string;
  delta: string;
  metadata: EntryMetadata;
}
export type Root = string | undefined;

export const rootOf = (run: Pick<RunTrajectory, "context">): Root => run.context?.workspaceRoot || undefined;
export const indexLine = ({ entries: _entries, omittedEntries: _omitted, ...meta }: RunTrajectory) => meta;

/** A run saved while still running was cut off when the IDE closed. */
export function settledStatus(status: RunTrajectory["status"]): RunTrajectory["status"] {
  return status === "running" ? "interrupted" : status;
}

/** A saved run the view can show: it carries its origin and context. */
export function isRestorableRun(run: RunTrajectory | null | undefined): run is RunTrajectory {
  return Boolean(run?.id && run.origin && run.context);
}

/** The runs in a legacy localStorage value, or undefined when it is not JSON. */
export function parseLegacyRuns(raw: string): RunTrajectory[] | undefined {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return undefined;
  }
}

export type TextBlock = { message_id?: string; delta: string };

/** A streamed text delta's block, when the payload carries one. */
export function textDelta(source: string, payload: unknown): TextBlock | undefined {
  if (!STREAMED_TEXT_SOURCES.has(source)) return undefined;
  const block = (payload as Record<string, { message_id?: string; delta?: string }> | null)?.[source];
  return typeof block?.delta === "string" ? (block as TextBlock) : undefined;
}

/** Whether a delta belongs to the pending text: same run, stream, message and agent. */
export function continuesText(pending: PendingText, next: { runId: string; source: string; messageId?: string; agentId?: string }): boolean {
  const sameStream = pending.runId === next.runId && pending.source === next.source;
  return sameStream && pending.messageId === next.messageId && pending.metadata.agentId === next.agentId;
}
