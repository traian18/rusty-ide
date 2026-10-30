import { describe, expect, it, vi } from "vitest";
import { SAFEGUARDS, TOKEN_OPTIMIZATIONS } from "./catalog";
import { recallRate, recordCondensed, recordRecall, resetTokenOptimizationStats, subscribeToTokenOptimizationStats, tokenOptimizationStats } from "./stats";
import { isOptimizationEnabled, optimizationSwitches, setOptimizationEnabled, subscribeToOptimizationSwitches } from "./switches";

describe("catalog", () => {
  it("describes every optimisation for people, and they all start on", () => {
    for (const optimization of TOKEN_OPTIMIZATIONS) {
      expect(optimization.name).not.toBe("");
      expect(optimization.summary.endsWith(".")).toBe(true);
      expect(optimization.details.length).toBeGreaterThan(optimization.summary.length);
      expect(optimization.defaultEnabled).toBe(true);
    }
    expect(new Set(TOKEN_OPTIMIZATIONS.map((optimization) => optimization.id)).size).toBe(TOKEN_OPTIMIZATIONS.length);
    expect(SAFEGUARDS.map((safeguard) => safeguard.name)).toEqual(["Never worse", "Fail open", "Stamps"]);
  });
});

describe("switches", () => {
  it("are on by default, change one at a time and tell their listeners", () => {
    expect(Object.values(optimizationSwitches()).every(Boolean)).toBe(true);
    const listener = vi.fn();
    const unsubscribe = subscribeToOptimizationSwitches(listener);
    setOptimizationEnabled("recall", false);
    expect(isOptimizationEnabled("recall")).toBe(false);
    expect(isOptimizationEnabled("command-output")).toBe(true);
    setOptimizationEnabled("recall", true);
    unsubscribe();
    expect(listener).toHaveBeenCalledTimes(2);
  });
});

describe("statistics", () => {
  it("add up per filter, give the recall rate and reset", () => {
    resetTokenOptimizationStats();
    const listener = vi.fn();
    const unsubscribe = subscribeToTokenOptimizationStats(listener);
    recordCondensed("git log", 1_000, 100, true);
    recordCondensed("git log", 3_000, 300, true);
    recordCondensed("tests", 500, 400, false);
    recordRecall("git log");
    unsubscribe();
    const stats = tokenOptimizationStats();
    expect(stats.filters["git log"]).toEqual({ runs: 2, rawChars: 4_000, shownChars: 400, stored: 2, recalled: 1 });
    expect(recallRate(stats.filters["git log"])).toBe(0.5);
    expect(recallRate(stats.filters.tests)).toBeUndefined();
    expect(listener).toHaveBeenCalledTimes(4);
    resetTokenOptimizationStats();
    expect(tokenOptimizationStats().filters).toEqual({});
  });
});
