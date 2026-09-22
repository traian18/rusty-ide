import { harness } from "../../harness";
import { usageMetricsService } from "../../services/usageMetricsService";
import type { WorkspaceSliceCreator } from "../sliceTypes";

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

/** `usage_update` messages carry each run's cumulative total, not a delta — track the last
 * seen value per run so only the newly-added tokens are added to today's running total. */
const lastCumulativeByRun = new Map<string, number>();
let refreshTimer: ReturnType<typeof setTimeout> | undefined;

/**
 * Module-level, not per-store: `harness` is itself one process-wide
 * singleton, so a second store instance subscribing again would just add a
 * second listener onto the same object rather than create a second
 * connection. Kept here as an unsubscribe function (previously discarded)
 * rather than a bare boolean, so a caller can undo it -- and so this
 * module's own tests can get a clean slate via vi.resetModules() + a fresh
 * dynamic import, rather than this guard leaking state across test cases.
 */
let unsubscribeFromUsageUpdates: (() => void) | undefined;

export const createMetricsSlice: WorkspaceSliceCreator = (set, get) => ({
  metricsSummary: null,
  metricsTimeframe: { mode: "day", day: todayKey() },
  metricsLoading: false,
  metricsTodayTotal: 0,

  /**
   * Was previously wired up unconditionally at slice-creation time --
   * against ARCHITECTURE.md's "slice import-time purity" rule -- purely
   * because touching the agentHarnessClient singleton (whose constructor
   * reads SIDECAR_WS_URL) at import time is itself a form of I/O-adjacent
   * side effect, even though subscribeUsage itself only registers a
   * listener and never opens a socket. Called once from
   * AppBootstrapBoundary instead (REFACTOR_PLAN.md PR 3a).
   */
  initMetricsSubscription: () => {
    if (unsubscribeFromUsageUpdates) return;
    unsubscribeFromUsageUpdates = harness.subscribeUsage((runId, usage) => {
      const total = usage.totalTokens ?? (usage.input || 0) + (usage.output || 0);
      get().applyUsageUpdate(runId, total);
    });
  },

  loadMetricsSummary: async () => {
    const { rootPath } = get();
    if (!rootPath) return;
    set({ metricsLoading: true });
    try {
      const summary = await usageMetricsService.loadSummary(rootPath);
      set({ metricsSummary: summary, metricsTodayTotal: usageMetricsService.todayTotal(summary) });
    } finally {
      set({ metricsLoading: false });
    }
  },

  setMetricsTimeframe: (timeframe) => set({ metricsTimeframe: timeframe }),

  /** Optimistically bumps today's running total on a live `usage_update` event, then debounces a full refresh. */
  applyUsageUpdate: (runKey, cumulativeTotal) => {
    const previous = lastCumulativeByRun.get(runKey) || 0;
    const delta = Math.max(0, cumulativeTotal - previous);
    lastCumulativeByRun.set(runKey, cumulativeTotal);
    if (delta > 0) set((state) => ({ metricsTodayTotal: state.metricsTodayTotal + delta }));
    if (refreshTimer) clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => void get().loadMetricsSummary(), 3_000);
  },
});
