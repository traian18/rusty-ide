import { invoke } from "@tauri-apps/api/core";
import type { MetricsTimeframe, UsageSummary, UsageTotals } from "../store";

const METRICS_SUMMARY_PATH = ".rusty/metrics/summary.json";

function emptyTotals(): UsageTotals {
  return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, calls: 0 };
}

export const usageMetricsService = {
  async loadSummary(rootPath: string): Promise<UsageSummary | null> {
    try {
      const content = await invoke<string>("read_file_disk", { path: `${rootPath}/${METRICS_SUMMARY_PATH}` });
      return JSON.parse(content) as UsageSummary;
    } catch {
      return null;
    }
  },

  todayTotal(summary: UsageSummary | null): number {
    if (!summary) return 0;
    const today = new Date().toISOString().slice(0, 10);
    return summary.byDay[today]?.total.totalTokens || 0;
  },
};

function addInto(target: UsageTotals, source: UsageTotals): void {
  target.input += source.input;
  target.output += source.output;
  target.cacheRead += source.cacheRead;
  target.cacheWrite += source.cacheWrite;
  target.totalTokens += source.totalTokens;
  target.calls += source.calls;
}

function daysInRange(from: string, to: string): string[] {
  const days: string[] = [];
  const cursor = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  while (cursor <= end) {
    days.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return days;
}

/** Resolves which day keys fall within the selected timeframe, for both totals and per-day breakdowns. */
export function dayKeysForTimeframe(summary: UsageSummary, timeframe: MetricsTimeframe): string[] {
  if (timeframe.mode === "day") return [timeframe.day];
  if (timeframe.mode === "range") return daysInRange(timeframe.from, timeframe.to);
  return Object.keys(summary.byDay).sort();
}

export function totalsForTimeframe(summary: UsageSummary | null, timeframe: MetricsTimeframe): UsageTotals {
  const totals = emptyTotals();
  if (!summary) return totals;
  if (timeframe.mode === "all-time") {
    addInto(totals, summary.allTime.total);
    return totals;
  }
  for (const day of dayKeysForTimeframe(summary, timeframe)) {
    const daySummary = summary.byDay[day];
    if (daySummary) addInto(totals, daySummary.total);
  }
  return totals;
}

export function byModelForTimeframe(summary: UsageSummary | null, timeframe: MetricsTimeframe): Array<{ model: string; totals: UsageTotals }> {
  if (!summary) return [];
  const byModel = new Map<string, UsageTotals>();
  if (timeframe.mode === "all-time") {
    for (const [model, totals] of Object.entries(summary.allTime.byModel)) {
      byModel.set(model, { ...totals });
    }
  } else {
    for (const day of dayKeysForTimeframe(summary, timeframe)) {
      const daySummary = summary.byDay[day];
      if (!daySummary) continue;
      for (const [model, totals] of Object.entries(daySummary.byModel)) {
        const existing = byModel.get(model) || emptyTotals();
        addInto(existing, totals);
        byModel.set(model, existing);
      }
    }
  }
  return [...byModel.entries()]
    .map(([model, totals]) => ({ model, totals }))
    // Entries with 0 total tokens are false positives (e.g. calls that never consumed tokens) and must never be displayed.
    .filter((entry) => entry.totals.totalTokens > 0)
    .sort((a, b) => b.totals.totalTokens - a.totals.totalTokens);
}

export function byDayForTimeframe(summary: UsageSummary | null, timeframe: MetricsTimeframe): Array<{ day: string; totals: UsageTotals }> {
  if (!summary) return [];
  const days = timeframe.mode === "day" ? [timeframe.day] : dayKeysForTimeframe(summary, timeframe);
  return days
    .map((day) => ({ day, totals: summary.byDay[day]?.total || emptyTotals() }))
    .filter((entry) => entry.totals.calls > 0 && entry.totals.totalTokens > 0)
    .sort((a, b) => a.day.localeCompare(b.day));
}
