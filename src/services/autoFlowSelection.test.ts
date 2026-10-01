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

function setup(response: JevDecisionResponse<unknown> | Error, reply = "") {
  const announced: string[] = [];
  const ask = vi.fn(async (_question: string, _options: Array<{ label: string; description?: string }>) => reply);
  const post = vi.fn(async () => {
    if (response instanceof Error) throw response;
    return response;
  }) as never;
  const run = () => chooseFlow({
    message: "how does sync work",
    candidates: CANDIDATES,
    router: { apiKey: "k", jevModelId: "m", post },
    ask,
    announce: (line) => announced.push(line),
  });
  return { announced, ask, run };
}

describe("chooseFlow", () => {
  it("runs a confident read-only pick straight away and says what it chose", async () => {
    const { run, ask, announced } = setup(answer("investigate", 0.88, { investigate: 0.88, single_agent: 0.12 }));
    expect(await run()).toEqual({ type: "workflow", candidate: CANDIDATES[0] });
    expect(ask).not.toHaveBeenCalled();
    expect(announced).toEqual(["↳ AUTO · Stage: Research & analyze (88% confidence)"]);
  });

  it("answers with the single agent when that is the confident pick", async () => {
    const { run, announced } = setup(answer(SINGLE_AGENT_ID, 0.92, { single_agent: 0.92, investigate: 0.08 }));
    expect(await run()).toEqual({ type: "single" });
    expect(announced).toEqual([`↳ AUTO · ${SINGLE_AGENT_NAME} (92% confidence)`]);
  });

  it("asks before running a pick that can change files, and runs it when the user agrees", async () => {
    const { run, ask, announced } = setup(answer("implement", 0.9, { implement: 0.9, design: 0.07, single_agent: 0.03 }), "Run Stage: Build & verify");
    expect(await run()).toEqual({ type: "workflow", candidate: CANDIDATES[2] });
    const [question, options] = ask.mock.calls[0];
    expect(question).toContain('Auto suggests "Stage: Build & verify" (90% confidence)');
    expect(options.map((option) => option.label)).toEqual(["Run Stage: Build & verify", SINGLE_AGENT_NAME, "Stage: Architect & plan"]);
    expect(options[0].description).toContain("It can change files.");
    expect(announced).toEqual(["↳ AUTO · Stage: Build & verify (you chose)"]);
  });

  it("offers a read-only alternative to a pick that edits, and honours the user's choice of it", async () => {
    const { run } = setup(answer("implement", 0.9, { implement: 0.9, design: 0.07, single_agent: 0.03 }), "Stage: Architect & plan");
    expect(await run()).toEqual({ type: "workflow", candidate: CANDIDATES[1] });
  });

  it("answers directly when the user declines the edit, and does nothing on an unrecognised reply", async () => {
    const response = answer("implement", 0.9, { implement: 0.9, design: 0.1 });
    expect(await setup(response, SINGLE_AGENT_NAME).run()).toEqual({ type: "single" });
    expect(await setup(response, "something else entirely").run()).toEqual({ type: "cancelled" });
    expect(await setup(response, "").run()).toEqual({ type: "cancelled" });
  });

  it("puts the likeliest options to the user when it is unsure, with the single agent always available", async () => {
    const { run, ask, announced } = setup(answer("investigate", 0.4, { investigate: 0.4, design: 0.35, implement: 0.2, single_agent: 0.05 }), "Stage: Architect & plan");
    expect(await run()).toEqual({ type: "workflow", candidate: CANDIDATES[1] });
    const [question, options] = ask.mock.calls[0];
    expect(question).toBe("Which workflow should handle this?");
    expect(options.map((option) => option.label)).toEqual(["Stage: Research & analyze", "Stage: Architect & plan", "Stage: Build & verify", SINGLE_AGENT_NAME]);
    expect(announced).toEqual(["↳ AUTO · Stage: Architect & plan (you chose)"]);
  });

  it("adds the single agent to the options when the likeliest ones leave it out", async () => {
    const { run, ask } = setup(answer("need_more_context", 0.9, { need_more_context: 0.9, investigate: 0.5, design: 0.3, implement: 0.19, single_agent: 0.01 }), SINGLE_AGENT_NAME);
    expect(await run()).toEqual({ type: "single" });
    expect(ask.mock.calls[0][1].map((option) => option.label)).toContain(SINGLE_AGENT_NAME);
  });

  it("falls back to the single agent, saying why, when the router cannot answer", async () => {
    const { run, ask, announced } = setup(new Error("offline"));
    expect(await run()).toEqual({ type: "single" });
    expect(ask).not.toHaveBeenCalled();
    expect(announced).toHaveLength(1);
    expect(announced[0]).toMatch(/^↳ AUTO · Could not choose a workflow \(Flow routing could not be reached: offline\); answering directly\.$/);
  });
});
