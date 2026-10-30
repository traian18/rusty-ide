import { describe, expect, it } from "vitest";
import { checkModelSwitch } from ".";
import { setOptimizationEnabled } from "../switches";
import { tokenOptimizationStats } from "../stats";
import { MIN_CACHEABLE_TOKENS, estimateConversationTokens, judgeModelSwitch } from "./warmCache";

describe("judgeModelSwitch", () => {
  it("allows any switch before anything is cached", () => {
    expect(judgeModelSwitch({ direction: "down", hasModelTurns: false }).allowed).toBe(true);
    expect(judgeModelSwitch({ direction: "down", hasModelTurns: true, conversationTokens: MIN_CACHEABLE_TOKENS - 1 }).allowed).toBe(true);
  });

  it("refuses a cheaper or unknown model on a warm cache, and allows a more capable one with its cost", () => {
    expect(judgeModelSwitch({ direction: "down", hasModelTurns: true, conversationTokens: 40_000 })).toEqual({
      allowed: false,
      reason: "Kept the current model: switching would re-read about 40,000 cached prompt tokens at full price, which no cheaper model wins back.",
    });
    expect(judgeModelSwitch({ direction: "unknown", hasModelTurns: true }).allowed).toBe(false);
    expect(judgeModelSwitch({ direction: "up", hasModelTurns: true, conversationTokens: 40_000 })).toEqual({
      allowed: true,
      reason: "Switching to a more capable model re-reads about 40,000 cached prompt tokens once at the new model's full price.",
    });
  });

  it("estimates a conversation's tokens from its messages", () => {
    expect(estimateConversationTokens([{ role: "User", content: "x".repeat(4_000) }])).toBeGreaterThan(1_000);
  });
});

describe("checkModelSwitch", () => {
  it("counts refusals, and allows everything when the guard is off", () => {
    const before = tokenOptimizationStats().refusedModelSwitches;
    expect(checkModelSwitch({ direction: "down", hasModelTurns: true }).allowed).toBe(false);
    expect(tokenOptimizationStats().refusedModelSwitches).toBe(before + 1);
    setOptimizationEnabled("warm-cache-guard", false);
    try {
      expect(checkModelSwitch({ direction: "down", hasModelTurns: true }).allowed).toBe(true);
    } finally {
      setOptimizationEnabled("warm-cache-guard", true);
    }
  });
});
