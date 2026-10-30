import { JevEntryStore } from "./jevEntryStore";

/** JEV's opinion of one proposed action, lowest-risk first. */
export const JEV_ACTION_VERDICTS = ["proceed", "revise", "stop"] as const;
export type JevActionVerdict = (typeof JEV_ACTION_VERDICTS)[number];

/** One tool call the shadow gate scored, and what then happened to it. */
export interface JevShadowEntry {
  /** `${sessionId}:${callId}` -- the tool call's observability record id. */
  id: string;
  at: string;
  runId: string;
  capability: string;
  /** The model that proposed the call. */
  model: string;
  tool: string;
  verdict?: JevActionVerdict;
  confidence?: number;
  cost?: number;
  /** Set when JEV could not score the call. */
  error?: string;
  /** How the call itself ended; unset while it is still running. */
  toolOutcome?: "succeeded" | "failed";
}

export interface JevShadowModelSummary {
  model: string;
  scored: number;
  verdicts: Record<JevActionVerdict, number>;
  errors: number;
  /** Among finished calls with a verdict: how many failed, split by whether JEV flagged them. */
  proceedFinished: number;
  proceedFailed: number;
  flaggedFinished: number;
  flaggedFailed: number;
  averageConfidence?: number;
  cost: number;
}

const STORAGE_KEY = "rusty_jev_shadow_entries";

export class JevShadowStats extends JevEntryStore<JevShadowEntry> {
  constructor(storage?: Pick<Storage, "getItem" | "setItem" | "removeItem">) {
    super(STORAGE_KEY, storage ?? (typeof localStorage === "undefined" ? undefined : localStorage));
  }
}

export function summarizeJevShadowByModel(entries: JevShadowEntry[]): JevShadowModelSummary[] {
  const byModel = new Map<string, JevShadowModelSummary & { confidenceSum: number }>();
  for (const entry of entries) {
    const summary = byModel.get(entry.model) ?? {
      model: entry.model,
      scored: 0,
      verdicts: { proceed: 0, revise: 0, stop: 0 },
      errors: 0,
      proceedFinished: 0,
      proceedFailed: 0,
      flaggedFinished: 0,
      flaggedFailed: 0,
      cost: 0,
      confidenceSum: 0,
    };
    byModel.set(entry.model, summary);
    summary.cost += entry.cost ?? 0;
    if (!entry.verdict) {
      if (entry.error) summary.errors += 1;
      continue;
    }
    summary.scored += 1;
    summary.verdicts[entry.verdict] += 1;
    summary.confidenceSum += entry.confidence ?? 0;
    if (!entry.toolOutcome) continue;
    const failed = entry.toolOutcome === "failed" ? 1 : 0;
    if (entry.verdict === "proceed") {
      summary.proceedFinished += 1;
      summary.proceedFailed += failed;
    } else {
      summary.flaggedFinished += 1;
      summary.flaggedFailed += failed;
    }
  }
  return [...byModel.values()]
    .map(({ confidenceSum, ...summary }) => ({
      ...summary,
      averageConfidence: summary.scored > 0 ? confidenceSum / summary.scored : undefined,
    }))
    .sort((a, b) => b.scored - a.scored || a.model.localeCompare(b.model));
}

export const jevShadowStats = new JevShadowStats();
