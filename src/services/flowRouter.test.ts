import { describe, expect, it, vi } from "vitest";
import {
  buildBoundaryState,
  buildMessageState,
  CONTINUE_ID,
  FLOW_ROUTING_TIMEOUT_MS,
  MAX_ASKED_OPTIONS,
  routeBoundary,
  routeMessage,
  SINGLE_AGENT_ID,
  type BoundaryRouteInput,
  type FlowDecisionTrace,
  type FlowOption,
} from "./flowRouter";
import type { JevDecisionResponse } from "./intelligentModelSelector";

const OPTIONS: FlowOption[] = [
  { id: SINGLE_AGENT_ID, name: "Single agent", criterion: "A quick question or small tweak.", edits: false },
  { id: "investigate", name: "Research & analyze", criterion: "Understand how something works.", edits: false },
  { id: "security-audit", name: "Security audit", criterion: "Review security.", edits: false },
  { id: "implement", name: "Build & verify", criterion: "Go ahead and change it.", edits: true },
];

function answer(choice: string, confidence: number, probabilities: Record<string, number>): JevDecisionResponse<unknown> {
  const result = { answers: { decision: { type: "choice", choice, confidence, probabilities } }, usage: { cost: 0.0001 } };
  return { status: 200, ok: true, result, text: JSON.stringify(result) };
}

const post = (response: JevDecisionResponse<unknown> | Error) =>
  vi.fn(async () => {
    if (response instanceof Error) throw response;
    return response;
  }) as never;

const deps = (response: JevDecisionResponse<unknown> | Error, extra: object = {}) => {
  const traces: FlowDecisionTrace[] = [];
  const postFn = post(response);
  return { traces, postFn, deps: { apiKey: "or-key", jevModelId: "typesafe/jev-1.13", post: postFn, onTrace: (trace: FlowDecisionTrace) => traces.push(trace), ...extra } };
};

type Body = { model: string; state: string; questions: { decision: { type: string; instructions: string; criteria: Record<string, string> } } };
const bodyOf = (postFn: unknown): Body => (postFn as { mock: { calls: Array<[string, Body]> } }).mock.calls[0][1];

describe("buildMessageState", () => {
  it("gives the message, and the last result with where it came from", () => {
    const state = buildMessageState({ message: "  design it  ", lastResult: " ## Findings\nThe queue. ", lastRun: { name: "Research & analyze", status: "completed" } });
    expect(state).toContain("Latest message:\ndesign it");
    expect(state).toContain("## Findings\nThe queue.");
    expect(state).toContain('The workflow "Research & analyze", which completed'.replace("The", "It came from the"));
  });

  it("says so when there is nothing earlier, and clips long input", () => {
    expect(buildMessageState({ message: "hi" })).toContain("There is no earlier result in this conversation.");
    const long = buildMessageState({ message: "m".repeat(9_000), lastResult: "r".repeat(9_000) });
    expect(long.length).toBeLessThan(7_500);
    expect(long).toContain("more characters]");
  });
});

describe("routeMessage", () => {
  const input = { message: "how does sync work", options: OPTIONS };

  it("asks JEV a choice over the options, keyed without hyphens, plus need_more_context", async () => {
    const { deps: d, postFn } = deps(answer("investigate", 0.9, { investigate: 0.9 }));
    await routeMessage(input, d);
    const body = bodyOf(postFn);
    expect(body.model).toBe("typesafe/jev-1.13");
    expect(body.questions.decision.type).toBe("choice");
    expect(Object.keys(body.questions.decision.criteria)).toEqual(["single_agent", "investigate", "security_audit", "implement", "need_more_context"]);
    expect(body.questions.decision.criteria.investigate).toBe("Understand how something works.");
    expect(body.state).toContain("how does sync work");
  });

  it("runs a decisive pick that cannot change files", async () => {
    const { deps: d, traces } = deps(answer("investigate", 0.88, { investigate: 0.88, single_agent: 0.08, security_audit: 0.04 }));
    expect(await routeMessage(input, d)).toEqual({ type: "run", id: "investigate", confidence: 0.88 });
    expect(traces).toHaveLength(1);
    expect(traces[0]).toMatchObject({ kind: "message", outcome: "decided", choice: "investigate", confidence: 0.88, cost: 0.0001 });
  });

  it("maps a hyphenated option back to its id", async () => {
    const { deps: d } = deps(answer("security_audit", 0.9, { security_audit: 0.9, investigate: 0.1 }));
    expect(await routeMessage(input, d)).toEqual({ type: "run", id: "security-audit", confidence: 0.9 });
  });

  it("asks before running a pick that can change files", async () => {
    const { deps: d } = deps(answer("implement", 0.9, { implement: 0.9, single_agent: 0.06, investigate: 0.04 }));
    expect(await routeMessage(input, d)).toEqual({
      type: "confirm",
      id: "implement",
      confidence: 0.9,
      ranked: [
        { id: "implement", probability: 0.9 },
        { id: "single_agent", probability: 0.06 },
        { id: "investigate", probability: 0.04 },
        { id: "security-audit", probability: 0 },
      ],
    });
  });

  it("puts the likeliest options to the user when the pick is not confident enough", async () => {
    const { deps: d } = deps(answer("investigate", 0.4, { investigate: 0.4, security_audit: 0.3, single_agent: 0.2, implement: 0.1 }));
    const route = await routeMessage(input, d);
    expect(route.type).toBe("ask");
    if (route.type !== "ask") return;
    expect(route.ranked.map((entry) => entry.id)).toEqual(["investigate", "security-audit", "single_agent", "implement"]);
    expect(route.ranked.length).toBeLessThanOrEqual(MAX_ASKED_OPTIONS);
  });

  it("asks when JEV says it needs more context, whatever its confidence", async () => {
    const { deps: d } = deps(answer("need_more_context", 0.95, { need_more_context: 0.95, investigate: 0.03, single_agent: 0.02 }));
    const route = await routeMessage(input, d);
    expect(route.type).toBe("ask");
    if (route.type === "ask") expect(route.ranked.map((entry) => entry.id)).not.toContain("need_more_context");
  });

  it("follows the configured confidence threshold", async () => {
    const response = answer("investigate", 0.7, { investigate: 0.7, single_agent: 0.3 });
    expect((await routeMessage(input, deps(response, { proceedConfidence: 0.6 }).deps)).type).toBe("run");
    expect((await routeMessage(input, deps(response, { proceedConfidence: 0.8 }).deps)).type).toBe("ask");
  });

  it("reports why it could not route, and records the failure", async () => {
    for (const [response, reason] of [
      [new Error("offline"), /could not be reached: offline/],
      [{ status: 429, ok: false, text: "slow" } as JevDecisionResponse<unknown>, /failed \(429\)/],
      [{ status: 200, ok: true, result: { answers: {} }, text: "{}" } as JevDecisionResponse<unknown>, /invalid answer/],
    ] as const) {
      const { deps: d, traces } = deps(response);
      const route = await routeMessage(input, d);
      expect(route.type).toBe("unavailable");
      if (route.type === "unavailable") expect(route.reason).toMatch(reason);
      expect(traces[0].outcome).toBe("failed");
    }
  });

  it("stops waiting for a slow decision service", async () => {
    vi.useFakeTimers();
    try {
      const hanging = vi.fn((_key: string, _body: unknown, signal?: AbortSignal) => new Promise<never>((_resolve, reject) => {
        signal?.addEventListener("abort", () => reject(new Error("aborted")));
      }));
      const pending = routeMessage(input, { apiKey: "k", jevModelId: "m", post: hanging as never });
      await vi.advanceTimersByTimeAsync(FLOW_ROUTING_TIMEOUT_MS + 1);
      expect((await pending).type).toBe("unavailable");
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("routeBoundary", () => {
  const targets = OPTIONS.filter((option) => option.id === "security-audit" || option.id === "implement");
  const input: BoundaryRouteInput = {
    request: "add password reset",
    workflowName: "Plan, build, verify",
    step: "Plan",
    finished: [{ name: "Plan", output: "1. Add the endpoint." }],
    remaining: ["Build", "Verify"],
    targets,
  };

  it("offers continue first, then the declared targets", async () => {
    const { deps: d, postFn } = deps(answer("continue", 0.9, { continue: 0.9 }));
    await routeBoundary(input, d);
    expect(Object.keys(bodyOf(postFn).questions.decision.criteria)).toEqual(["continue", "security_audit", "implement", "need_more_context"]);
  });

  it("continues when JEV chooses to continue", async () => {
    expect(await routeBoundary(input, deps(answer("continue", 0.95, { continue: 0.95, security_audit: 0.05 })).deps)).toEqual({ type: "continue" });
  });

  it("continues when it is unsure, rather than holding the run", async () => {
    expect(await routeBoundary(input, deps(answer("security_audit", 0.4, { security_audit: 0.4, continue: 0.35 })).deps)).toEqual({ type: "continue" });
    expect(await routeBoundary(input, deps(answer("need_more_context", 0.9, { need_more_context: 0.9 })).deps)).toEqual({ type: "continue" });
  });

  it("switches on a decisive pick of a workflow that cannot change files", async () => {
    const { deps: d, traces } = deps(answer("security_audit", 0.87, { security_audit: 0.87, continue: 0.1 }));
    expect(await routeBoundary(input, d)).toEqual({ type: "switch", id: "security-audit", confidence: 0.87 });
    expect(traces[0]).toMatchObject({ kind: "boundary", choice: "security-audit" });
  });

  it("asks before switching to a workflow that can change files", async () => {
    expect(await routeBoundary(input, deps(answer("implement", 0.9, { implement: 0.9, continue: 0.1 })).deps)).toEqual({ type: "confirm", id: "implement", confidence: 0.9 });
  });

  it("continues, saying why, when the decision service fails", async () => {
    const route = await routeBoundary(input, deps(new Error("offline")).deps);
    expect(route.type).toBe("continue");
    expect(route).toMatchObject({ reason: expect.stringContaining("offline") });
  });

  it("never offers a hand-over that was not declared", async () => {
    const { deps: d, postFn } = deps(answer("continue", 0.9, { continue: 0.9 }));
    await routeBoundary({ ...input, targets: [] }, d);
    expect(Object.keys(bodyOf(postFn).questions.decision.criteria)).toEqual(["continue", "need_more_context"]);
    expect(CONTINUE_ID).toBe("continue");
  });
});

describe("buildBoundaryState", () => {
  const base: BoundaryRouteInput = { request: "r", workflowName: "Flow", step: "Two", finished: [], remaining: [], targets: [] };

  it("names the workflow, the step that just finished, the finished outputs latest first, and what is left", () => {
    const state = buildBoundaryState({
      ...base,
      finished: [{ name: "One", output: "first output" }, { name: "Two", output: "second output" }],
      remaining: ["Three"],
    });
    expect(state).toContain('("Flow")');
    expect(state).toContain('after the step "Two"');
    expect(state.indexOf("### Two")).toBeLessThan(state.indexOf("### One"));
    expect(state).toContain("Steps still to run: Three.");
    expect(buildBoundaryState(base)).toContain("No steps remain.");
  });

  it("keeps the latest steps and says how many earlier ones it left out", () => {
    const finished = Array.from({ length: 6 }, (_, index) => ({ name: `S${index + 1}`, output: "x".repeat(3_500) }));
    const state = buildBoundaryState({ ...base, finished });
    expect(state).toContain("### S6");
    expect(state).not.toContain("### S1");
    expect(state).toMatch(/\[\d+ earlier step\(s\) omitted\]/);
    expect(state.length).toBeLessThan(16_000);
  });
});
