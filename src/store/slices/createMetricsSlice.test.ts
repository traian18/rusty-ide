import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMetricsTestStore } from "../../test/metricsTestStore";
import type { TokenUsage } from "../../harness/contract";

/**
 * Every test re-imports both createMetricsSlice.ts and the harness module
 * fresh via vi.resetModules() + dynamic import -- both hold module-level
 * singleton state (the unsubscribe guard, and the `harness` instance
 * itself), so a static top-level import would let one test's subscription
 * leak into the next.
 */
beforeEach(() => {
  vi.resetModules();
});

async function freshMetricsSlice() {
  const [{ createMetricsSlice }, harnessModule] = await Promise.all([
    import("./createMetricsSlice"),
    import("../../harness"),
  ]);
  return { createMetricsSlice, harness: harnessModule.harness };
}

describe("createMetricsSlice: creation-time purity (REFACTOR_PLAN.md PR 3a)", () => {
  it("does not touch harness.subscribeUsage at slice creation", async () => {
    const { createMetricsSlice, harness } = await freshMetricsSlice();
    const subscribeUsageSpy = vi.spyOn(harness, "subscribeUsage");

    createMetricsTestStore(createMetricsSlice);

    expect(subscribeUsageSpy).not.toHaveBeenCalled();
  });
});

describe("createMetricsSlice: initMetricsSubscription", () => {
  it("subscribes exactly once even when called multiple times", async () => {
    const { createMetricsSlice, harness } = await freshMetricsSlice();
    const subscribeUsageSpy = vi.spyOn(harness, "subscribeUsage");
    const store = createMetricsTestStore(createMetricsSlice);

    store.getState().initMetricsSubscription();
    store.getState().initMetricsSubscription();
    store.getState().initMetricsSubscription();

    expect(subscribeUsageSpy).toHaveBeenCalledTimes(1);
  });

  it("routes a usage update to applyUsageUpdate", async () => {
    const { createMetricsSlice, harness } = await freshMetricsSlice();
    let capturedListener: ((runId: string, usage: TokenUsage) => void) | undefined;
    vi.spyOn(harness, "subscribeUsage").mockImplementation((listener) => {
      capturedListener = listener;
      return () => {};
    });
    const store = createMetricsTestStore(createMetricsSlice);

    store.getState().initMetricsSubscription();
    capturedListener?.("run-1", { totalTokens: 42 });

    expect(store.getState().metricsTodayTotal).toBe(42);
  });
});
