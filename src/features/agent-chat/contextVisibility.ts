// What one open chat shows of its requests' context: the estimated input budget left for its
// latest main-agent request, and the start and finish of each compaction operation. All of it is
// transient: it is never saved with the chat, and a reopened chat starts without it.
//
// Freshness: the last estimate shown stays until a newer one replaces it, so the indicator updates
// in place instead of vanishing at every request start (it used to clear there, and the bar blinked
// out and back on each request). An update counts only for the latest request (by its dispatch
// order) and only when it is newer than the update already shown (by its agent sequence), so a
// replayed or delayed update never replaces a newer one; an update saying the estimate is
// unavailable keeps the last one. A session that was replaced is retired: nothing it reports
// afterwards is shown, and its last estimate stays until the new session reports one. Only a model
// change hides the estimate, since its numbers no longer apply.

import type { CompactionKind, CompactionResult, ContextEstimate, ContextObservation } from "../../harness/contract";

export interface ContextVisibility {
  /** The session the shown estimate comes from. */
  sessionId: string | null;
  /** Sessions whose estimates no longer count: replaced, or from before a model change. */
  retired: Set<string>;
  /** The latest qualifying request, and the agent sequence of its update shown. */
  latest: { agentId: string; order: number; requestId: string; sequence: number | null } | null;
  estimate: ContextEstimate | null;
  /** Lifecycle observations already shown, by event id. */
  shown: Set<string>;
  /** The transient console message each run's lifecycle lines are written to, by run id. */
  cards: Map<string, { messageId: string; lines: string[] }>;
}

export function emptyVisibility(): ContextVisibility {
  return { sessionId: null, retired: new Set(), latest: null, estimate: null, shown: new Set(), cards: new Map() };
}

/** Hides the estimate until a request started after this reports one: the model changed. */
export function invalidateEstimate(state: ContextVisibility): void {
  if (state.sessionId) state.retired.add(state.sessionId);
  state.sessionId = null;
  state.latest = null;
  state.estimate = null;
}

/** Applies a request start or an estimate; true when the shown estimate changed. */
export function applyRequestObservation(state: ContextVisibility, observation: ContextObservation): boolean {
  if (observation.type === "compaction" || !observation.qualifying) return false;
  const { sessionId, agentId, requestStartOrder: order, requestId, agentSequence } = observation.identity;
  if (state.retired.has(sessionId)) return false;
  const before = state.estimate;
  if (sessionId !== state.sessionId) {
    // Another session replaces this one: nothing the old one reports counts any more, but its last
    // estimate stays shown until the new one reports.
    if (state.sessionId) state.retired.add(state.sessionId);
    state.sessionId = sessionId;
    state.latest = null;
  }
  const latest = state.latest;
  const newer = !latest || latest.agentId !== agentId || order > latest.order;
  if (observation.type === "request_started") {
    // The previous estimate stays shown until this request reports its own.
    if (newer) state.latest = { agentId, order, requestId, sequence: null };
    return false;
  }
  if (newer) {
    // An update for a request whose start was not seen: it is still the latest.
    state.latest = { agentId, order, requestId, sequence: agentSequence };
    state.estimate = observation.estimate ?? state.estimate;
  } else if (order === latest.order && (latest.sequence === null || agentSequence > latest.sequence)) {
    latest.sequence = agentSequence;
    state.estimate = observation.estimate ?? state.estimate;
  }
  return before !== state.estimate;
}

const TYPE_NAMES: Record<CompactionKind, string> = { standard: "Standard compaction", background_summary: "Background summary" };

const OUTCOME_WORDS: Record<CompactionKind, Record<CompactionResult, string>> = {
  standard: { success: "completed", failure: "failed", cancelled: "cancelled" },
  // Ready, not applied: the summary is used on a later request.
  background_summary: { success: "ready", failure: "failed", cancelled: "cancelled" },
};

/** The transcript line for a lifecycle observation, or undefined when it was already shown. */
export function lifecycleLine(state: ContextVisibility, observation: ContextObservation): string | undefined {
  if (observation.type !== "compaction" || state.shown.has(observation.identity.eventId)) return undefined;
  state.shown.add(observation.identity.eventId);
  const name = TYPE_NAMES[observation.compactionType];
  if (observation.phase === "started") return `${name} started.`;
  return `${name} ${OUTCOME_WORDS[observation.compactionType][observation.outcome ?? "failure"]}.`;
}

/** The accessible text of an estimate, which the header shows beside the token counter. */
export function estimateText(estimate: ContextEstimate): string {
  return `Estimated input remaining: ${estimate.remainingInputTokens.toLocaleString("en-US")} input tokens (${estimate.usagePercent}% used)`;
}
