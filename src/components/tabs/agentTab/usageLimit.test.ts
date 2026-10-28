import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AgentMessage } from "../../../store/types";
import { createTurnState, type AgentTurn } from "./turn";
import { CONTINUE_AFTER_RESET_MS, cancelContinue, continueDelay, scheduleContinue, usageLimitOffer, usageLimitReset } from "./usageLimit";

const FAILURE = "Error: The model provider's usage limit was reached. It accepts requests again in about 4 h 39 min, at 21:59 UTC (resets_at=2026-10-25T21:59:00Z). Continue the run then: finished tasks are kept.";
const message = (content: string, role: AgentMessage["role"] = "assistant"): AgentMessage => ({ id: content.slice(0, 8), role, content, timestamp: "2026-10-25" });

describe("usageLimitReset", () => {
  it("reads when the limit resets from the failure", () => {
    expect(usageLimitReset(FAILURE)?.toISOString()).toBe("2026-10-25T21:59:00.000Z");
    expect(usageLimitReset("Error: RateLimited { retry_after: None }")).toBeUndefined();
    expect(usageLimitReset(undefined)).toBeUndefined();
  });

  it("waits until a minute after the reset, and not at all once it is past", () => {
    const resets = new Date("2026-10-25T21:59:00Z");
    expect(continueDelay(resets, resets.getTime() - 10_000)).toBe(10_000 + CONTINUE_AFTER_RESET_MS);
    expect(continueDelay(resets, resets.getTime() + 5 * 60_000)).toBe(0);
  });
});

describe("continuing after a usage limit", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-25T21:00:00Z"));
  });
  afterEach(() => vi.useRealTimers());

  const chat = (chatId: string) => {
    const views: Record<string, string | undefined> = {};
    const turn = {
      chatId,
      state: createTurnState(),
      ui: { setContinueAt: (at: string | undefined) => { views[chatId] = at; } },
    } as unknown as AgentTurn;
    return { turn, continueAt: () => views[chatId] };
  };
  const resets = new Date("2026-10-25T21:59:00Z");

  it("offers nothing when the last message is not a usage-limit failure", () => {
    const actions = { schedule: vi.fn(), cancel: vi.fn() };
    expect(usageLimitOffer([message(FAILURE), message("next question", "user")], undefined, actions)).toBeUndefined();
    const offer = usageLimitOffer([message(FAILURE)], undefined, actions);
    expect(offer?.scheduled).toBe(false);
    offer?.schedule();
    expect(actions.schedule).toHaveBeenCalledWith(resets);
    expect(usageLimitOffer([message(FAILURE)], resets.toISOString(), actions)?.scheduled).toBe(true);
  });

  it("continues the chat it was scheduled in, a minute after the reset", () => {
    const first = chat("a");
    const send = vi.fn();
    scheduleContinue(first.turn, resets, send);
    expect(first.continueAt()).toBe(resets.toISOString());
    vi.advanceTimersByTime(59 * 60_000);
    expect(send).not.toHaveBeenCalled();
    vi.advanceTimersByTime(CONTINUE_AFTER_RESET_MS);
    expect(send).toHaveBeenCalledWith(first.turn);
    expect(first.continueAt()).toBeUndefined();
  });

  it("sends nothing once cancelled, closed or busy, and two chats keep their own", () => {
    const [a, b, c] = [chat("a"), chat("b"), chat("c")];
    const send = vi.fn();
    scheduleContinue(a.turn, resets, send);
    scheduleContinue(b.turn, resets, send);
    scheduleContinue(c.turn, resets, send);
    cancelContinue(a.turn);
    b.turn.state.isStreaming = true;
    vi.advanceTimersByTime(2 * 3600_000);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith(c.turn);
  });
});
