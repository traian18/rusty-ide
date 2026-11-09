import { describe, expect, it } from "vitest";
import type { ContextEstimate, ContextObservation } from "../../harness/contract";
import { applyRequestObservation, emptyVisibility, estimateText, invalidateEstimate, lifecycleLine } from "./contextVisibility";

const estimate = (remaining: number): ContextEstimate => ({
  model: "m", estimatedInputTokens: 100, inputBudget: 100 + remaining, modelWindow: 1_000, remainingInputTokens: remaining, usagePercent: 40,
});

let nextEvent = 1;
function identity(order: number, sequence = nextEvent, session = "s1", agent = "a1") {
  return { eventId: `e${nextEvent++}`, sessionId: session, agentId: agent, runId: "r1", requestId: `q${order}`, requestStartOrder: order, agentSequence: sequence };
}
const start = (order: number, session = "s1", qualifying = true): ContextObservation =>
  ({ type: "request_started", identity: identity(order, nextEvent, session), qualifying });
const update = (order: number, sequence: number, value: ContextEstimate | null, session = "s1", qualifying = true): ContextObservation =>
  ({ type: "estimate", identity: identity(order, sequence, session), qualifying, estimate: value });

describe("context estimate freshness", () => {
  it("is hidden until an estimate arrives, and hidden again when it is unavailable", () => {
    const state = emptyVisibility();
    expect(state.estimate).toBeNull();
    applyRequestObservation(state, start(0));
    expect(applyRequestObservation(state, update(0, 10, estimate(500)))).toBe(true);
    expect(state.estimate?.remainingInputTokens).toBe(500);
    expect(applyRequestObservation(state, update(0, 11, null))).toBe(true);
    expect(state.estimate).toBeNull();
  });

  it("hides the previous estimate as soon as a new request starts, and keeps it hidden if that request fails", () => {
    const state = emptyVisibility();
    applyRequestObservation(state, start(0));
    applyRequestObservation(state, update(0, 10, estimate(500)));
    applyRequestObservation(state, start(1));
    expect(state.estimate).toBeNull();
    // The new request failed or was cancelled before its estimate: nothing comes, nothing shows,
    // and the older request's estimate, replayed, does not come back.
    applyRequestObservation(state, update(0, 10, estimate(500)));
    expect(state.estimate).toBeNull();
  });

  it("never lets an older start or update replace a newer one", () => {
    const state = emptyVisibility();
    applyRequestObservation(state, start(2));
    applyRequestObservation(state, update(2, 20, estimate(300)));
    applyRequestObservation(state, start(1));
    applyRequestObservation(state, update(1, 15, estimate(900)));
    expect(state.estimate?.remainingInputTokens).toBe(300);
    // Same request, older update (reversed delivery or replay).
    applyRequestObservation(state, update(2, 21, estimate(250)));
    applyRequestObservation(state, update(2, 19, null));
    expect(state.estimate?.remainingInputTokens).toBe(250);
  });

  it("ignores subagents, workflow steps and summaries", () => {
    const state = emptyVisibility();
    applyRequestObservation(state, start(0));
    applyRequestObservation(state, update(0, 10, estimate(500)));
    applyRequestObservation(state, start(5, "s1", false));
    applyRequestObservation(state, update(5, 30, estimate(1), "s1", false));
    expect(state.estimate?.remainingInputTokens).toBe(500);
  });

  it("drops a replaced session's estimate and anything it sends later", () => {
    const state = emptyVisibility();
    applyRequestObservation(state, start(0, "old"));
    applyRequestObservation(state, update(0, 10, estimate(500), "old"));
    applyRequestObservation(state, start(0, "new"));
    expect(state.estimate).toBeNull();
    applyRequestObservation(state, update(0, 11, estimate(700), "old"));
    expect(state.estimate).toBeNull();
    applyRequestObservation(state, update(0, 12, estimate(800), "new"));
    expect(state.estimate?.remainingInputTokens).toBe(800);
  });

  it("stays hidden after a model change until a request started afterwards reports one", () => {
    const state = emptyVisibility();
    applyRequestObservation(state, start(0, "s1"));
    applyRequestObservation(state, update(0, 10, estimate(500), "s1"));
    invalidateEstimate(state);
    expect(state.estimate).toBeNull();
    applyRequestObservation(state, update(1, 11, estimate(400), "s1"));
    expect(state.estimate).toBeNull();
    applyRequestObservation(state, start(0, "s2"));
    applyRequestObservation(state, update(0, 12, estimate(600), "s2"));
    expect(state.estimate?.remainingInputTokens).toBe(600);
  });
});

describe("compaction activity text", () => {
  const compaction = (type: "standard" | "background_summary", phase: "started" | "finished", outcome?: "success" | "failure" | "cancelled"): ContextObservation =>
    ({ type: "compaction", identity: identity(0), operationId: "op", compactionType: type, phase, outcome });

  it("says what started and how it ended, and that a ready summary is not yet applied", () => {
    const state = emptyVisibility();
    expect(lifecycleLine(state, compaction("standard", "started"))).toBe("Standard compaction started.");
    expect(lifecycleLine(state, compaction("standard", "finished", "success"))).toBe("Standard compaction completed.");
    expect(lifecycleLine(state, compaction("standard", "finished", "failure"))).toBe("Standard compaction failed.");
    expect(lifecycleLine(state, compaction("standard", "finished", "cancelled"))).toBe("Standard compaction cancelled.");
    expect(lifecycleLine(state, compaction("background_summary", "started"))).toBe("Background summary started.");
    expect(lifecycleLine(state, compaction("background_summary", "finished", "success"))).toBe("Background summary ready.");
    expect(lifecycleLine(state, compaction("background_summary", "finished", "failure"))).toBe("Background summary failed.");
    expect(lifecycleLine(state, compaction("background_summary", "finished", "cancelled"))).toBe("Background summary cancelled.");
  });

  it("shows a redelivered event once", () => {
    const state = emptyVisibility();
    const once = compaction("standard", "started");
    expect(lifecycleLine(state, once)).toBeDefined();
    expect(lifecycleLine(state, once)).toBeUndefined();
  });

  it("puts the estimate in words, with its unit", () => {
    expect(estimateText(estimate(12_345))).toBe("Estimated input remaining: 12,345 input tokens (40% used)");
  });
});
