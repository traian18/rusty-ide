import { describe, expect, it } from "vitest";
import type { AgentEvent, AgentEventEnvelope } from "@rusty/harness-sdk";
import type { ContextObservation } from "../../contract";
import { LifecycleTracker, toObservation } from "./contextObservations";

let next = 1;
function envelope(event: AgentEvent, overrides: Partial<AgentEventEnvelope> = {}): AgentEventEnvelope {
  const id = next++;
  return {
    event_id: `evt-${id}`, session_id: "s1", agent_id: "a1", parent_agent_id: null, run_id: "r1",
    agent_sequence: id, session_sequence: id, timestamp: "", visibility: "User", event, ...overrides,
  };
}

const request = { request_id: "q1", request_start_order: 2 };
const started = (operation: string, type: "standard" | "background_summary" = "standard") => envelope({
  CompactionStarted: { ...request, operation_id: operation, compaction_type: type, compaction_started: true, compaction_ended: false },
});
const finished = (operation: string, outcome: "success" | "failure" | "cancelled" = "success", type: "standard" | "background_summary" = "standard") => envelope({
  CompactionFinished: { ...request, operation_id: operation, compaction_type: type, outcome, compaction_started: false, compaction_ended: true },
});
const observe = (value: AgentEventEnvelope) => toObservation(value, true)!;
const summary = (shown: ContextObservation[]) => shown.map((o) => o.type === "compaction" ? `${o.operationId}:${o.phase}${o.startMissing ? ":missing" : ""}` : o.type);

describe("context observations", () => {
  it("maps request starts and estimates with their origin and order, and nothing else", () => {
    const start = toObservation(envelope({ ContextRequestStarted: { ...request, model: "m" } }), true);
    expect(start).toMatchObject({ type: "request_started", qualifying: true, identity: { sessionId: "s1", agentId: "a1", runId: "r1", requestId: "q1", requestStartOrder: 2 } });
    const available = toObservation(envelope({
      ContextUpdated: { ...request, model: "m", compaction_started: false, compaction_ended: false, availability: { available: { estimated_input_tokens: 10, input_budget: 90, model_window: 100, remaining_input_tokens: 80, usage_percent: 12 } } },
    }), false);
    expect(available).toMatchObject({ type: "estimate", qualifying: false, estimate: { remainingInputTokens: 80, usagePercent: 12, inputBudget: 90, model: "m" } });
    const unavailable = toObservation(envelope({
      ContextUpdated: { ...request, model: null, compaction_started: false, compaction_ended: false, availability: { unavailable: { reason: "unknown_model_window" } } },
    }), true);
    expect(unavailable).toMatchObject({ type: "estimate", estimate: null });
    // A managed environment that reports none of this produces nothing.
    expect(toObservation(envelope({ RunStarted: { run_id: "r1" } }), true)).toBeUndefined();
  });

  it("shows each lifecycle event once, even when it is delivered again", () => {
    const tracker = new LifecycleTracker();
    const start = observe(started("op1"));
    expect(summary(tracker.accept(start).show)).toEqual(["op1:started"]);
    expect(tracker.accept(start).show).toEqual([]);
    const finish = observe(finished("op1"));
    expect(summary(tracker.accept(finish).show)).toEqual(["op1:finished"]);
    expect(tracker.accept(finish).show).toEqual([]);
  });

  it("holds a finish that came before its start, and shows the recovered start first", () => {
    const tracker = new LifecycleTracker();
    const start = observe(started("op1"));
    const finish = observe(finished("op1", "failure"));
    const early = tracker.accept(finish);
    expect(early).toEqual({ show: [], recover: true });
    expect(tracker.holding()).toBe(true);
    const shown = tracker.recovered([start, finish]);
    expect(summary(shown)).toEqual(["op1:started", "op1:finished"]);
    expect(shown[1]).toMatchObject({ outcome: "failure" });
    expect(tracker.holding()).toBe(false);
  });

  it("shows a finish whose start cannot be recovered once, without inventing a start", () => {
    const tracker = new LifecycleTracker();
    tracker.accept(observe(finished("op1", "cancelled")));
    const shown = tracker.recovered([]);
    expect(summary(shown)).toEqual(["op1:finished:missing"]);
    expect(shown[0]).toMatchObject({ outcome: "cancelled" });
    expect(tracker.recovered([])).toEqual([]);
  });

  it("keeps overlapping operations apart", () => {
    const tracker = new LifecycleTracker();
    const shown = [started("a"), started("b"), finished("b"), finished("a")].flatMap((e) => tracker.accept(observe(e)).show);
    expect(summary(shown)).toEqual(["a:started", "b:started", "b:finished", "a:finished"]);
  });

  it("does not hold a finish it cannot recover (a workflow step's session)", () => {
    const tracker = new LifecycleTracker();
    expect(summary(tracker.accept(observe(finished("op1")), false).show)).toEqual(["op1:finished:missing"]);
  });

  it("counts background summaries until they finish", () => {
    const tracker = new LifecycleTracker();
    tracker.accept(observe(started("s1", "background_summary")));
    tracker.accept(observe(started("c1")));
    expect(tracker.pendingSummaries()).toBe(1);
    tracker.accept(observe(finished("s1", "success", "background_summary")));
    expect(tracker.pendingSummaries()).toBe(0);
  });
});
