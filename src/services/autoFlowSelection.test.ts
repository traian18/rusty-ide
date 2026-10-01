import { describe, expect, it, vi } from "vitest";
import { chooseFlow, SINGLE_AGENT_NAME, type FlowCandidate } from "./autoFlowSelection";
import { SINGLE_AGENT_ID } from "./flowRouter";
import type { JevDecisionResponse } from "./intelligentModelSelector";

const CANDIDATES: FlowCandidate[] = [
  { id: "investigate", name: "Stage: Research & analyze", criterion: "Understand how something works.", edits: false, path: "builtin:investigate" },
  { id: "design", name: "Stage: Architect & plan", criterion: "Design and plan.", edits: false, path: "builtin:design" },
  { id: "implement", name: "Stage: Build & verify", criterion: "Go ahead and change it.", edits: true, path: "builtin:implement" },
];

function answer(choice: string, confidence: number, probabilities: Record<string, number>): JevDecisionResponse<unknown> {
  const result = { answers: { decision: { type: "choice", choice, confidence, probabilities } } };
  return { status: 200, ok: true, result, text: JSON.stringify(result) };
}

function setup(response: JevDecisionResponse<unknown> | Error) {
  const announced: string[] = [];
  const post = vi.fn(async () => {
    if (response instanceof Error) throw response;
    return response;
  });
  const run = (extra: object = {}) => chooseFlow({
    message: "how does sync work",
    candidates: CANDIDATES,
    router: { apiKey: "k", jevModelId: "m", post: post as never },
    announce: (line) => announced.push(line),
    ...extra,
  });
  return { announced, post, run };
}

describe("chooseFlow", () => {
  it("runs a confident read-only pick straight away and says what it chose", async () => {
    const { run, announced } = setup(answer("investigate", 0.88, { investigate: 0.88, single_agent: 0.12 }));
    expect(await run()).toEqual({ type: "workflow", candidate: CANDIDATES[0] });
    expect(announced).toEqual(["↳ AUTO · Stage: Research & analyze (88% confidence)"]);
  });

  it("answers with the single agent when that is the confident pick", async () => {
    const { run, announced } = setup(answer(SINGLE_AGENT_ID, 0.92, { single_agent: 0.92, investigate: 0.08 }));
    expect(await run()).toEqual({ type: "single" });
    expect(announced).toEqual([`↳ AUTO · ${SINGLE_AGENT_NAME} (92% confidence)`]);
  });

  it("runs a confident pick that can change files without asking, and says it can", async () => {
    const { run, announced } = setup(answer("implement", 0.9, { implement: 0.9, design: 0.07, single_agent: 0.03 }));
    expect(await run()).toEqual({ type: "workflow", candidate: CANDIDATES[2] });
    expect(announced).toEqual(["↳ AUTO · Stage: Build & verify (90% confidence) · can change files"]);
  });

  it("answers with the single agent, without asking, when no workflow fits clearly", async () => {
    for (const response of [
      answer("investigate", 0.4, { investigate: 0.4, design: 0.35, implement: 0.2, single_agent: 0.05 }),
      answer("need_more_context", 0.9, { need_more_context: 0.9, investigate: 0.5, design: 0.3, implement: 0.19, single_agent: 0.01 }),
    ]) {
      const { run, announced } = setup(response);
      expect(await run()).toEqual({ type: "single" });
      expect(announced).toEqual([`↳ AUTO · ${SINGLE_AGENT_NAME} (no workflow was a clear fit)`]);
    }
  });

  it("falls back to the single agent, saying why, when the router cannot answer", async () => {
    const { run, announced } = setup(new Error("offline"));
    expect(await run()).toEqual({ type: "single" });
    expect(announced).toHaveLength(1);
    expect(announced[0]).toMatch(/^↳ AUTO · Could not choose a workflow \(Flow routing could not be reached: offline\); answering directly\.$/);
  });

  it("lets the router see the conversation, so a follow-up is routed with it", async () => {
    const { run, post } = setup(answer("implement", 0.9, { implement: 0.9, design: 0.1 }));
    await run({ message: "ok do it", recentRequests: ["what should we change in sync?"], lastResult: "Plan: split the queue." });
    const state = (post.mock.calls[0] as unknown as [string, { state: string }])[1].state;
    expect(state).toContain("ok do it");
    expect(state).toContain("- what should we change in sync?");
    expect(state).toContain("Plan: split the queue.");
  });
});
