import { JevEntryStore } from "./jevEntryStore";
import type { JevActionVerdict } from "./jevShadowStats";

/** What happened to a risky action after JEV reviewed it. */
export type JevReviewOutcome =
  /** JEV confidently let it run. */
  | "allowed"
  /** JEV judged it flawed; the agent was told why. */
  | "blocked"
  /** JEV flagged or could not judge it, and the user decided. */
  | "user_allowed"
  | "user_blocked"
  /** JEV flagged or could not judge it, and there was no user to ask. */
  | "blocked_unattended";

/** One risky action reviewed before it ran. */
export interface JevReviewEntry {
  id: string;
  at: string;
  capability: string;
  /** The model that proposed the action. */
  model: string;
  tool: string;
  concern: string;
  verdict?: JevActionVerdict;
  confidence?: number;
  outcome?: JevReviewOutcome;
  cost?: number;
  /** Set when JEV could not review the action. */
  error?: string;
}

export interface JevReviewModelSummary {
  model: string;
  reviewed: number;
  outcomes: Record<JevReviewOutcome, number>;
  errors: number;
  cost: number;
}

const OUTCOMES: JevReviewOutcome[] = ["allowed", "blocked", "user_allowed", "user_blocked", "blocked_unattended"];

export class JevReviewStats extends JevEntryStore<JevReviewEntry> {
  constructor(storage?: Pick<Storage, "getItem" | "setItem" | "removeItem">) {
    super("rusty_jev_review_entries", storage ?? (typeof localStorage === "undefined" ? undefined : localStorage));
  }
}

export function summarizeJevReviewsByModel(entries: JevReviewEntry[]): JevReviewModelSummary[] {
  const byModel = new Map<string, JevReviewModelSummary>();
  for (const entry of entries) {
    const summary = byModel.get(entry.model) ?? {
      model: entry.model,
      reviewed: 0,
      outcomes: Object.fromEntries(OUTCOMES.map((outcome) => [outcome, 0])) as Record<JevReviewOutcome, number>,
      errors: 0,
      cost: 0,
    };
    byModel.set(entry.model, summary);
    summary.cost += entry.cost ?? 0;
    if (entry.error) summary.errors += 1;
    if (!entry.outcome) continue;
    summary.reviewed += 1;
    summary.outcomes[entry.outcome] += 1;
  }
  return [...byModel.values()].sort((a, b) => b.reviewed - a.reviewed || a.model.localeCompare(b.model));
}

export const jevReviewStats = new JevReviewStats();
