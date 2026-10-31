import { describe, expect, it } from "vitest";
import { CACHE_LIFETIME_MS, PromptCacheWatch, type CachedRequest } from "./watch";

function harness() {
  const recorded: CachedRequest[] = [];
  let now = 0;
  const watch = new PromptCacheWatch((request) => recorded.push(request), () => now);
  return { watch, recorded, advance: (ms: number) => (now += ms) };
}

describe("PromptCacheWatch", () => {
  it("judges a request once it is over, from its last snapshot", () => {
    const { watch, recorded } = harness();
    watch.usage("a", "a:0", { input: 10, cacheRead: 0, cacheWrite: 0 });
    watch.usage("a", "a:0", { input: 10, cacheRead: 0, cacheWrite: 5000 });
    expect(recorded).toEqual([]);
    watch.usage("a", "a:1", { input: 20, cacheRead: 5000, cacheWrite: 300 });
    watch.endAgent("a");
    expect(recorded).toEqual([
      { input: 10, cacheRead: 0, cacheWrite: 5000, followUp: false, unreported: false },
      { input: 20, cacheRead: 5000, cacheWrite: 300, followUp: true, unreported: false },
    ]);
  });

  it("names a changed prefix before expiry and history", () => {
    const { watch, recorded } = harness();
    watch.usage("a", "a:0", { input: 10, cacheRead: 0, cacheWrite: 5000 });
    watch.prefixChange("a");
    watch.usage("a", "a:1", { input: 10, cacheRead: 0, cacheWrite: 5200 });
    watch.endAgent("a");
    expect(recorded[1].miss).toBe("prefix");
  });

  it("calls a miss after the cache lifetime expired, and any other miss history", () => {
    const { watch, recorded, advance } = harness();
    watch.usage("a", "a:0", { input: 10, cacheRead: 0, cacheWrite: 5000 });
    advance(CACHE_LIFETIME_MS + 1);
    watch.usage("a", "a:1", { input: 10, cacheRead: 0, cacheWrite: 5200 });
    advance(1000);
    watch.usage("a", "a:2", { input: 10, cacheRead: 100, cacheWrite: 5300 });
    watch.endAgent("a");
    expect(recorded.map((r) => r.miss)).toEqual([undefined, "expired", "history"]);
  });

  it("uses input as the whole prompt for providers that report no cache writes", () => {
    const { watch, recorded } = harness();
    watch.usage("a", "a:0", { input: 8000, cacheRead: 0 });
    watch.usage("a", "a:1", { input: 8500, cacheRead: 7900 });
    watch.usage("a", "a:2", { input: 9000, cacheRead: 0 });
    watch.endAgent("a");
    expect(recorded.map((r) => r.miss)).toEqual([undefined, undefined, "history"]);
  });

  it("does not judge unreported or uncacheably small prompts, and keeps agents apart", () => {
    const { watch, recorded } = harness();
    watch.usage("a", "a:0", { input: 5000 });
    watch.usage("b", "b:0", { input: 200, cacheRead: 0 });
    watch.usage("a", "a:1", { input: 5100 });
    watch.usage("b", "b:1", { input: 300, cacheRead: 0 });
    watch.endAgent("a");
    watch.endAgent("b");
    expect(recorded.filter((r) => r.miss)).toEqual([]);
    expect(recorded.filter((r) => r.followUp && r.unreported)).toHaveLength(1);
  });
});
