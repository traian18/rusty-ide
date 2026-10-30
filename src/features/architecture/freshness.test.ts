import { describe, expect, it } from "vitest";
import { describeFreshness, formatAge, staleSummary } from "./freshness";

describe("freshness", () => {
  it("formats ages in the largest sensible unit", () => {
    expect(formatAge(0)).toBe("just now");
    expect(formatAge(44_000)).toBe("just now");
    expect(formatAge(3 * 60_000)).toBe("3 min ago");
    expect(formatAge(5 * 3_600_000)).toBe("5 h ago");
    expect(formatAge(3 * 86_400_000)).toBe("3 d ago");
    expect(formatAge(-5)).toBe("just now");
  });

  it("reports none, fresh, and stale", () => {
    expect(describeFreshness(null, 1000, [], []).state).toBe("none");
    const fresh = describeFreshness(0, 120_000, [], []);
    expect(fresh).toMatchObject({ state: "fresh", builtAgo: "2 min ago" });
    const stale = describeFreshness(0, 0, ["a.rs", "b.rs"], ["c.rs"]);
    expect(stale).toMatchObject({ state: "stale", changedCount: 2, missingCount: 1 });
  });

  it("summarises what changed", () => {
    expect(staleSummary(describeFreshness(0, 0, ["a"], []))).toBe("1 file changed since");
    expect(staleSummary(describeFreshness(0, 0, ["a", "b"], ["c"]))).toBe("2 files changed, 1 removed since");
    expect(staleSummary(describeFreshness(0, 0, [], []))).toBe("");
  });
});
