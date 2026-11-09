import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../features/permissions/service/commandPermissionService", () => ({
  commandPermissionService: { request: vi.fn(() => new Promise(() => undefined)) },
}));

import { AUTO_DECIDE, AUTO_KEEPS_LIMITS, autoQuestionAnswer, autoQuestionReply, autoWorkflowAnswer, isAutoMode, setAutoMode, unlessAuto } from "./autoMode";
import { createRunHost } from "./hostDefaults";
import { commandPermissionService } from "../features/permissions";
import type { CommandPermissionRequest } from "../../shared/agent-protocol";
import type { WorkflowQuestion } from "./contract";

const question = (kind: string, requestId: string, ids: string[]): WorkflowQuestion => ({
  requestId,
  step: "Build",
  kind,
  prompt: "?",
  subject: null,
  decisions: ids.map((id) => ({ id, label: id, requiresText: id === "request_changes" || id === "revise_plan" })),
});

describe("auto mode", () => {
  afterEach(() => setAutoMode(false));

  it("approves steps, tries a failed task once more and then skips it, and never stops", () => {
    expect(autoWorkflowAnswer(question("approval", "plan:1", ["approve", "request_changes", "reject"]))).toEqual({ decision: "approve", auto: true });
    const failure = (n: number) => question("task_failure", `build:1:T3:${n}`, ["retry", "skip", "revise_plan", "stop"]);
    expect(autoWorkflowAnswer(failure(0))).toMatchObject({ decision: "retry", auto: true });
    expect(autoWorkflowAnswer(failure(1))).toEqual({ decision: "skip", auto: true });
    expect(autoWorkflowAnswer(question("other", "x:1", ["stop", "revise_plan"]))).toMatchObject({ decision: "revise_plan", text: expect.any(String) });
  });

  it("revises the plan for a design gap instead of skipping the task and everything built on it", () => {
    const gap = { ...question("task_failure", "build:1:T2:0", ["retry", "skip", "revise_plan", "stop"]), subject: { task: "T2", problem: "Where does routeId come from? Recommended: the IDE launch.", design_gap: true } };
    expect(autoWorkflowAnswer(gap)).toMatchObject({ decision: "revise_plan", text: expect.stringContaining("Where does routeId come from?"), auto: true });
    // Without a plan to revise: the planner takes its own recommendation once, then the run stops with the question.
    const noPlan = (n: number) => ({ ...gap, requestId: `build:1:T9:${n}`, decisions: gap.decisions.filter((d) => d.id !== "revise_plan") });
    expect(autoWorkflowAnswer(noPlan(0))).toMatchObject({ decision: "retry", text: expect.stringContaining("recommended answer") });
    expect(autoWorkflowAnswer(noPlan(1))).toEqual({ decision: "stop", auto: true });
  });

  it("takes a question's first suggestion, or leaves the decision to the agent", () => {
    expect(autoQuestionAnswer({ requestId: "q", question: "Allow?", options: [{ label: "Allow" }, { label: "Block" }] })).toBe("Allow");
    expect(autoQuestionAnswer({ requestId: "q", question: "Which?", options: [] })).toBe(AUTO_DECIDE);
  });

  it("never lets a taken suggestion lift the limits the agent was given", () => {
    const reply = autoQuestionReply("Expand scope");
    expect(reply).toContain("The first suggestion was taken: Expand scope.");
    expect(reply).toContain(AUTO_KEEPS_LIMITS);
    expect(autoQuestionReply(AUTO_DECIDE)).not.toContain("first suggestion was taken");
    expect(autoQuestionReply(AUTO_DECIDE)).toContain(AUTO_KEEPS_LIMITS);
  });

  it("asks while it is off, and answers what is waiting as soon as it is turned on", async () => {
    let asked: AbortSignal | undefined;
    const answer = unlessAuto(() => "auto", (signal) => {
      asked = signal;
      return new Promise<string>(() => undefined);
    }, new AbortController().signal);
    expect(asked?.aborted).toBe(false);
    setAutoMode(true);
    await expect(answer).resolves.toBe("auto");
    expect(asked?.aborted).toBe(true);
    expect(isAutoMode()).toBe(true);
  });

  it("passes the user's answer through and stops asking when the run stops", async () => {
    await expect(unlessAuto(() => "auto", () => Promise.resolve("mine"), new AbortController().signal)).resolves.toBe("mine");
    const run = new AbortController();
    let asked: AbortSignal | undefined;
    const answer = unlessAuto(() => "auto", (signal) => {
      asked = signal;
      return new Promise<string>((_, reject) => signal.addEventListener("abort", () => reject(new Error("withdrawn"))));
    }, run.signal);
    run.abort();
    await expect(answer).rejects.toThrow("withdrawn");
    expect(asked?.aborted).toBe(true);
  });

  it("is how every run host asks: permissions, questions and workflow steps", async () => {
    const askQuestion = vi.fn(() => new Promise<string>(() => undefined));
    const askWorkflowInput = vi.fn(() => new Promise<never>(() => undefined));
    const host = createRunHost({ askQuestion, askWorkflowInput });
    const signal = new AbortController().signal;
    const permission = host.requestPermission({ requestId: "p" } as CommandPermissionRequest, signal);
    expect(commandPermissionService.request).toHaveBeenCalled();
    setAutoMode(true);
    await expect(permission).resolves.toBe("allow_once");
    await expect(host.askQuestion!({ requestId: "q", question: "?", options: [{ label: "Yes" }] }, signal)).resolves.toBe("Yes");
    await expect(host.askWorkflowInput!(question("approval", "a:1", ["approve"]), signal)).resolves.toEqual({ decision: "approve", auto: true });
    expect(askQuestion).not.toHaveBeenCalled();
    expect(askWorkflowInput).not.toHaveBeenCalled();
  });
});
