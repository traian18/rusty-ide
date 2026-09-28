import type { AutoLevel } from "../store/intelligentModelSelectionTypes";
import { JevEntryStore } from "./jevEntryStore";
import type { JevShadowEntry } from "./jevShadowStats";

/** What a `decide` call told the agent to do. */
export const JEV_DECISION_BANDS = ["proceed", "verify", "escalate"] as const;
export type JevDecisionBand = (typeof JEV_DECISION_BANDS)[number];

/** One `decide` call an agent made. */
export interface JevDecisionEntry {
  id: string;
  at: string;
  capability: string;
  /** The model that asked for the decision. */
  model: string;
  kind: "choice" | "yes_no";
  question: string;
  /** 1 for the first call on a question, counting the calls sent back for more evidence. */
  attempt: number;
  band?: JevDecisionBand;
  /** JEV's top option; `need_more_context` when it judged the facts insufficient. */
  choice?: string;
  confidence?: number;
  /** How an escalated decision was settled. */
  resolvedBy?: "user" | "best_guess";
  cost?: number;
  /** Set when JEV could not decide. */
  error?: string;
  /** The agent's next tool calls after acting on the decision, as
   * `${sessionId}:${callId}` (the shadow gate's entry ids), and how many failed. */
  followUpCallIds?: string[];
  followUpFailed?: number;
  /** For AUTO runs: JEV's level for the remaining work... */
  assessedLevel?: AutoLevel;
  /** ...and the level the run switched to because of it. */
  steppedUpTo?: AutoLevel;
}

export interface JevDecisionModelSummary {
  model: string;
  decisions: number;
  bands: Record<JevDecisionBand, number>;
  /** Decisions where JEV judged the agent's facts insufficient. */
  needMoreContext: number;
  errors: number;
  averageConfidence?: number;
  cost: number;
  /** Decisions after which an AUTO run switched to a more capable model. */
  steppedUp: number;
  /** Tool calls the agent made after acting on a decision... */
  followUpCalls: number;
  /** ...how many failed... */
  followUpFailed: number;
  /** ...and, of those the shadow gate scored, how many it flagged (Revise or Stop). */
  followUpScored: number;
  followUpFlagged: number;
}

/** How often acted-on decisions in one confidence range were followed by trouble. */
export interface JevDecisionCalibrationBucket {
  /** Inclusive lower bound, exclusive upper (the last bucket includes 1). */
  from: number;
  to: number;
  decisions: number;
  followUpCalls: number;
  followUpFailed: number;
  followUpScored: number;
  followUpFlagged: number;
}

interface FollowUpCounts {
  followUpCalls: number;
  followUpFailed: number;
  followUpScored: number;
  followUpFlagged: number;
}

function followUpCounts(entry: JevDecisionEntry, shadow: Map<string, JevShadowEntry>): FollowUpCounts {
  const ids = entry.followUpCallIds ?? [];
  let scored = 0;
  let flagged = 0;
  for (const id of ids) {
    const verdict = shadow.get(id)?.verdict;
    if (!verdict) continue;
    scored += 1;
    if (verdict !== "proceed") flagged += 1;
  }
  return { followUpCalls: ids.length, followUpFailed: entry.followUpFailed ?? 0, followUpScored: scored, followUpFlagged: flagged };
}

function addCounts<T extends FollowUpCounts>(target: T, counts: FollowUpCounts): void {
  target.followUpCalls += counts.followUpCalls;
  target.followUpFailed += counts.followUpFailed;
  target.followUpScored += counts.followUpScored;
  target.followUpFlagged += counts.followUpFlagged;
}

const shadowById = (entries: JevShadowEntry[]) => new Map(entries.map((entry) => [entry.id, entry]));

export class JevDecisionStats extends JevEntryStore<JevDecisionEntry> {
  constructor(storage?: Pick<Storage, "getItem" | "setItem" | "removeItem">) {
    super("rusty_jev_decision_entries", storage ?? (typeof localStorage === "undefined" ? undefined : localStorage));
  }
}

export function summarizeJevDecisionsByModel(entries: JevDecisionEntry[], shadowEntries: JevShadowEntry[] = []): JevDecisionModelSummary[] {
  const shadow = shadowById(shadowEntries);
  const byModel = new Map<string, JevDecisionModelSummary & { confidenceSum: number }>();
  for (const entry of entries) {
    const summary = byModel.get(entry.model) ?? {
      model: entry.model,
      decisions: 0,
      bands: { proceed: 0, verify: 0, escalate: 0 },
      needMoreContext: 0,
      errors: 0,
      cost: 0,
      confidenceSum: 0,
      steppedUp: 0,
      followUpCalls: 0,
      followUpFailed: 0,
      followUpScored: 0,
      followUpFlagged: 0,
    };
    byModel.set(entry.model, summary);
    summary.cost += entry.cost ?? 0;
    if (!entry.band) {
      if (entry.error) summary.errors += 1;
      continue;
    }
    summary.decisions += 1;
    summary.bands[entry.band] += 1;
    summary.confidenceSum += entry.confidence ?? 0;
    if (entry.choice === "need_more_context") summary.needMoreContext += 1;
    if (entry.steppedUpTo) summary.steppedUp += 1;
    addCounts(summary, followUpCounts(entry, shadow));
  }
  return [...byModel.values()]
    .map(({ confidenceSum, ...summary }) => ({
      ...summary,
      averageConfidence: summary.decisions > 0 ? confidenceSum / summary.decisions : undefined,
    }))
    .sort((a, b) => b.decisions - a.decisions || a.model.localeCompare(b.model));
}

/** Confidence ranges for calibration; the default threshold (0.6) is a boundary. */
const CALIBRATION_BOUNDS = [0, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1];

/**
 * Groups decisions the agent acted on without asking the user (Decided, and
 * best-guess escalations) by JEV's confidence. If trouble after acting stays
 * flat above some confidence, the threshold can be lowered to that range;
 * if it rises in the lowest acted-on range, the threshold should go up.
 */
export function calibrateJevDecisions(entries: JevDecisionEntry[], shadowEntries: JevShadowEntry[] = []): JevDecisionCalibrationBucket[] {
  const shadow = shadowById(shadowEntries);
  const buckets: JevDecisionCalibrationBucket[] = CALIBRATION_BOUNDS.slice(0, -1).map((from, index) => ({
    from,
    to: CALIBRATION_BOUNDS[index + 1],
    decisions: 0,
    followUpCalls: 0,
    followUpFailed: 0,
    followUpScored: 0,
    followUpFlagged: 0,
  }));
  for (const entry of entries) {
    const actedOn = entry.band === "proceed" || (entry.band === "escalate" && entry.resolvedBy === "best_guess");
    if (!actedOn || typeof entry.confidence !== "number") continue;
    const bucket = buckets.find((candidate, index) =>
      entry.confidence! >= candidate.from && (entry.confidence! < candidate.to || index === buckets.length - 1));
    if (!bucket) continue;
    bucket.decisions += 1;
    addCounts(bucket, followUpCounts(entry, shadow));
  }
  return buckets;
}

export const jevDecisionStats = new JevDecisionStats();
