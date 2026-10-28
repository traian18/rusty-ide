import { beforeEach, describe, expect, it, vi } from "vitest";

const client = vi.hoisted(() => ({ create: vi.fn(), afterPass: vi.fn(), control: vi.fn(), list: vi.fn() }));
vi.mock("../../../goals/goalClient", () => ({ goalClient: client }));
vi.mock("../../../notificationStore", () => ({ notify: vi.fn() }));
vi.mock("../../../services/repositoryContextInput", () => ({ repositoryContextInput: () => ({ enabled: true }) }));
vi.mock("../../../store", () => ({ useWorkspaceStore: { getState: () => ({}) } }));

import type { GoalStep } from "../../../goals/goalClient";
import { continueGoal, handleGoalCommand, passChecks, passReport } from "./goalTurn";
import { createTurnState, nextMessageId, type AgentTurn } from "./turn";

function turn(): AgentTurn & { messages: Array<{ id: string; role: string; content: string }> } {
  const messages: Array<{ id: string; role: string; content: string }> = [];
  return {
    chatId: "chat-1",
    rootPath: "/ws",
    state: createTurnState(),
    ui: { setStreamingLabel: vi.fn() },
    chat: { save: vi.fn().mockResolvedValue(undefined) },
    addMessage: (message: { id: string; role: string; content: string }) => messages.push(message),
    messages,
  } as unknown as AgentTurn & { messages: typeof messages };
}

function step(status: GoalStep["goal"]["status"], passes: number, prompt: string | null, verdict?: string): GoalStep {
  return {
    goal: { id: "g-1", status, instruction: "tidy", scope: ["src/a.ts"], targets: { checks: ["test"], guidelines: true }, budget: { max_passes: 8, no_progress_passes: 2 }, chat_id: "chat-1", passes },
    prompt,
    status: `Goal (${status})`,
    decision: verdict ? { verdict: verdict as never, status, unmet: [], undo: false, reason: "why", summary: "health 7" } : null,
    undone: [],
  };
}

describe("goal passes", () => {
  beforeEach(() => Object.values(client).forEach((fn) => fn.mockReset()));

  it("reads the pass's status line and its judgement of a goal in words", () => {
    expect(passReport("Fixed it.\n\n**Done when:** no — load() reads the disk\n\nStatus: done")).toEqual({ agent_status: "done", done_when_met: false, judge_reason: "load() reads the disk" });
    expect(passReport("Status: blocked — needs a key")).toEqual({ agent_status: "blocked — needs a key" });
    expect(passReport("nothing")).toEqual({});
  });

  it("counts a required check the pass did not run as not run", () => {
    expect(passChecks(["test", "typecheck"], [{ name: "test", passed: true, ran: true, summary: "" }])).toEqual([
      { name: "test", passed: true, ran: true, summary: "" },
      { name: "typecheck", passed: false, ran: false, summary: "not run" },
    ]);
  });

  it("starts a goal with its first pass, then sends the next pass while it runs and stops when it is done", async () => {
    const chat = turn();
    const send = vi.fn().mockResolvedValue(undefined);
    client.create.mockResolvedValue(step("running", 0, "pass 1 prompt"));
    await handleGoalCommand(chat, "/goal checks=test tidy", ["/ws/src/a.ts"], send);
    expect(client.create).toHaveBeenCalledWith("/ws", undefined, expect.objectContaining({ instruction: "tidy", scope: ["src/a.ts"] }), "chat-1");
    expect(send).toHaveBeenCalledWith("pass 1 prompt", { id: "g-1", pass: 1, checks: ["test"] });
    expect(chat.state.goal).toEqual({ id: "g-1", pass: 1, checks: ["test"] });

    client.afterPass.mockResolvedValue(step("running", 1, "pass 2 prompt", "continue"));
    await continueGoal(chat, chat.state.goal!, { response: "Status: done", modifiedFiles: ["/ws/src/a.ts"], checks: [] }, send);
    expect(client.afterPass).toHaveBeenCalledWith("/ws", undefined, "g-1", { agent_status: "done" }, [{ name: "test", passed: false, ran: false, summary: "not run" }], ["src/a.ts"]);
    expect(send).toHaveBeenLastCalledWith("pass 2 prompt", { id: "g-1", pass: 2, checks: ["test"] });

    client.afterPass.mockResolvedValue(step("done", 2, null, "done"));
    await continueGoal(chat, chat.state.goal!, { response: "", modifiedFiles: [] }, send);
    expect(send).toHaveBeenCalledTimes(2);
    expect(chat.state.goal).toBeUndefined();
    expect(chat.messages.at(-1)?.content).toContain("Goal pass 2: goal reached");
    // The chat keys its rows by id: a repeated one leaves a stale row on screen in other chats.
    expect(new Set(chat.messages.map((m) => m.id)).size).toBe(chat.messages.length);
  });

  it("never hands out the same message id twice, even within one millisecond", () => {
    const ids = Array.from({ length: 50 }, () => nextMessageId());
    expect(new Set(ids).size).toBe(50);
    expect(ids.every((id) => /^msg_\d+$/.test(id))).toBe(true);
  });

  it("does not go on when the goal was paused while the pass ran", async () => {
    const chat = turn();
    const send = vi.fn();
    client.afterPass.mockResolvedValue(step("running", 1, "next", "continue"));
    await continueGoal(chat, { id: "g-1", pass: 1, checks: [] }, { response: "", modifiedFiles: [] }, send);
    expect(send).not.toHaveBeenCalled();
  });

  it("controls the chat's goal and says when there is none", async () => {
    const chat = turn();
    client.list.mockResolvedValue([]);
    await handleGoalCommand(chat, "/goal pause", [], vi.fn());
    expect(chat.messages.at(-1)?.content).toContain("no goal");
    client.list.mockResolvedValue([step("paused", 3, null)]);
    client.control.mockResolvedValue(step("running", 0, "resumed prompt"));
    const send = vi.fn();
    await handleGoalCommand(chat, "/goal resume", [], send);
    expect(client.control).toHaveBeenCalledWith("/ws", undefined, "g-1", "resume");
    expect(send).toHaveBeenCalledWith("resumed prompt", { id: "g-1", pass: 1, checks: ["test"] });
    await handleGoalCommand(chat, "/goal health=99 x", [], send);
    expect(chat.messages.at(-1)?.content).toContain("not started");
  });
});
