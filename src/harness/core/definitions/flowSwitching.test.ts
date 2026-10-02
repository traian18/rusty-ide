import { beforeEach, describe, expect, it, vi } from "vitest";

const post = vi.hoisted(() => vi.fn());
vi.mock("../../../services/intelligentModelSelector", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../services/intelligentModelSelector")>()),
  postJevDecision: post,
}));

import type { AgentChatInput, CapabilityEvent } from "../../contract";
import type { WorkflowBoundaryContext } from "../CoreHarness";
import { agentChatBoundary, agentChatSwitched, handOverContext } from "./flowSwitching";

const TARGETS = [
  { id: "diagnose", path: "builtin:diagnose", name: "Stage: Debug & plan a fix", when: "Something is broken.", edits: false },
  { id: "implement", path: "builtin:implement", name: "Stage: Build & verify", when: "Go ahead and change it.", edits: true },
];

function decision(choice: string, confidence: number, probabilities: Record<string, number>) {
  const result = { answers: { decision: { type: "choice", choice, confidence, probabilities } } };
  return { status: 200, ok: true, result, text: JSON.stringify(result) };
}

function context(overrides: Partial<WorkflowBoundaryContext<"agent_chat">> = {}, answer?: string) {
  const events: CapabilityEvent<"agent_chat">[] = [];
  const askQuestion = vi.fn(async () => answer ?? "");
  const input = {
    tabId: "agent",
    workspaceRoot: "/ws",
    flowSwitching: { router: { apiKey: "k", jevModelId: "m" }, workflowName: "Plan, build, verify", targets: TARGETS },
  } as unknown as AgentChatInput;
  const value = {
    input,
    host: { askQuestion } as never,
    ctx: { scratch: {} },
    onEvent: (event: CapabilityEvent<"agent_chat">) => events.push(event),
    signal: new AbortController().signal,
    step: { id: "plan", name: "Plan" },
    finished: [{ id: "plan", name: "Plan", output: "1. The failing test is in sync.rs." }],
    remaining: ["Build", "Verify"],
    request: "add password reset",
    ...overrides,
  } as WorkflowBoundaryContext<"agent_chat">;
  return { value, events, askQuestion };
}

beforeEach(() => post.mockReset());

describe("handOverContext", () => {
  const from = { name: "Plan, build, verify", step: "Plan" };

  it("says where the work came from and why, then gives each finished step's output", () => {
    const text = handOverContext(from, "it fits better", [
      { id: "plan", name: "Plan", output: "the plan" },
      { id: "build", name: "Build", output: "  " },
    ]);
    expect(text).toContain('Handed over from "Plan, build, verify" after the "Plan" step: it fits better');
    expect(text).toContain("### Plan\nthe plan");
    expect(text).toContain("### Build\n(no output)");
  });

  it("preserves every completed step even when the prompt preview would be too long", () => {
    const steps = Array.from({ length: 4 }, (_, index) => ({ id: `s${index}`, name: `S${index + 1}`, output: "x".repeat(10_000) }));
    const text = handOverContext(from, "r", steps);
    expect(text.length).toBeGreaterThan(40_000);
    expect(text).toContain("### S4");
    expect(text).toContain("### S1");
    expect(text).not.toContain("omitted");
  });
});

describe("agentChatBoundary", () => {
  it("carries on without asking anything when nothing is declared", async () => {
    const { value } = context({ input: { flowSwitching: { router: { apiKey: "k", jevModelId: "m" }, workflowName: "W", targets: [] } } as never });
    expect(await agentChatBoundary(value)).toEqual({ type: "continue" });
    expect(post).not.toHaveBeenCalled();
  });

  it("carries on when the router says to", async () => {
    post.mockResolvedValue(decision("continue", 0.9, { continue: 0.9, diagnose: 0.1 }));
    expect(await agentChatBoundary(context().value)).toEqual({ type: "continue" });
  });

  it("hands over to a workflow that cannot change files, carrying the finished work as context", async () => {
    post.mockResolvedValue(decision("diagnose", 0.86, { diagnose: 0.86, continue: 0.14 }));
    const { value, askQuestion } = context();
    const decided = await agentChatBoundary(value);
    expect(askQuestion).not.toHaveBeenCalled();
    expect(decided.type).toBe("switch");
    if (decided.type !== "switch") return;
    expect(decided.outcome).toMatchObject({
      id: "diagnose",
      name: "Stage: Debug & plan a fix",
      path: "builtin:diagnose",
      confidence: 0.86,
      from: { name: "Plan, build, verify", step: "Plan" },
    });
    const { context: handed, reason } = decided.outcome as { context: string; reason: string };
    expect(reason).toContain('fit "Stage: Debug & plan a fix" better than carrying on');
    expect(handed).toContain("### Plan\n1. The failing test is in sync.rs.");
    expect(handed).toContain(reason);
  });

  it("hands over to a workflow that can change files without asking, and the chat says it can", async () => {
    post.mockResolvedValue(decision("implement", 0.9, { implement: 0.9, continue: 0.1 }));
    const { value, askQuestion } = context();
    const decided = await agentChatBoundary(value);
    expect(askQuestion).not.toHaveBeenCalled();
    expect(decided.type).toBe("switch");
    if (decided.type !== "switch") return;
    expect(decided.outcome).toMatchObject({ id: "implement", edits: true, confidence: 0.9 });
    expect((decided.outcome as { reason: string }).reason).not.toContain("you agreed");
    expect(agentChatSwitched(decided.outcome, { scratch: {} }).response).toMatch(/^↪ AUTO · Handing over to Stage: Build & verify \(90% confidence\): .* It can change files\.$/);
  });

  it("does not claim a read-only workflow can change files", async () => {
    post.mockResolvedValue(decision("diagnose", 0.86, { diagnose: 0.86, continue: 0.14 }));
    const decided = await agentChatBoundary(context().value);
    if (decided.type !== "switch") throw new Error("expected a switch");
    expect(agentChatSwitched(decided.outcome, { scratch: {} }).response).not.toContain("It can change files");
  });

  it("carries on, and says why, when the decision service fails", async () => {
    // (An unreachable service is covered in flowRouter.test.ts; here the service answers with an error.)
    post.mockResolvedValue({ status: 503, ok: false, text: "unavailable" });
    const { value, events } = context();
    expect(await agentChatBoundary(value)).toEqual({ type: "continue" });
    expect(events).toContainEqual({ kind: "log", message: "Flow check skipped: Flow routing failed (503)." });
  });

  it("asks the router only about the declared targets, with the run's own steps as state", async () => {
    post.mockResolvedValue(decision("continue", 0.9, { continue: 0.9 }));
    await agentChatBoundary(context().value);
    const body = post.mock.calls[0][1] as { questions: { decision: { criteria: Record<string, string> } }; state: string };
    expect(Object.keys(body.questions.decision.criteria)).toEqual(["continue", "diagnose", "implement", "need_more_context"]);
    expect(body.questions.decision.criteria.diagnose).toBe("Something is broken.");
    expect(body.state).toContain("add password reset");
    expect(body.state).toContain("### Plan");
    expect(body.state).toContain("Steps still to run: Build, Verify.");
  });
});

describe("agentChatSwitched", () => {
  it("announces the hand-over and carries the switch and the files changed so far", () => {
    const switchTo = { id: "diagnose", name: "Stage: Debug & plan a fix", path: "builtin:diagnose", reason: "it fits", confidence: 0.86, context: "c", from: { name: "W", step: "Plan" } };
    const result = agentChatSwitched(switchTo, { scratch: { modifiedFiles: new Set(["a.ts"]) } });
    expect(result.response).toBe("↪ AUTO · Handing over to Stage: Debug & plan a fix (86% confidence): it fits.");
    expect(result.switchTo).toBe(switchTo);
    expect(result.modifiedFiles).toEqual(["a.ts"]);
    expect(agentChatSwitched(switchTo, { scratch: {} }).modifiedFiles).toEqual([]);
  });
});
