import React, { useEffect, useMemo, useState } from "react";
import { Gauge, RefreshCw } from "lucide-react";
import { useWorkspaceStore } from "../../store";
import type { MetricsTimeframe } from "../../store";
import { Callout } from "../ui";
import { formatCompactTokenCount } from "../../services/tokenFormat";
import { byDayForTimeframe, byModelForTimeframe, totalsForTimeframe } from "../../services/usageMetricsService";

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function daysAgo(days: number): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - days);
  return isoDate(date);
}

type PresetId = "today" | "yesterday" | "7d" | "30d" | "all" | "custom";

function timeframeForPreset(preset: PresetId, customFrom: string, customTo: string): MetricsTimeframe {
  switch (preset) {
    case "today":
      return { mode: "day", day: isoDate(new Date()) };
    case "yesterday":
      return { mode: "day", day: daysAgo(1) };
    case "7d":
      return { mode: "range", from: daysAgo(6), to: isoDate(new Date()) };
    case "30d":
      return { mode: "range", from: daysAgo(29), to: isoDate(new Date()) };
    case "all":
      return { mode: "all-time" };
    case "custom":
      return { mode: "range", from: customFrom || daysAgo(6), to: customTo || isoDate(new Date()) };
  }
}

const PRESETS: Array<{ id: PresetId; label: string }> = [
  { id: "today", label: "Today" },
  { id: "yesterday", label: "Yesterday" },
  { id: "7d", label: "7 days" },
  { id: "30d", label: "30 days" },
  { id: "all", label: "All time" },
  { id: "custom", label: "Custom" },
];

function StatTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-[var(--bg-app)]/50 border border-[var(--border-color)] rounded-xl px-4 py-3 flex flex-col space-y-1">
      <span className="text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-wider font-mono">{label}</span>
      <span className="text-xl font-bold text-[var(--text-light)] font-mono">{value}</span>
    </div>
  );
}

export const MetricsTab: React.FC = () => {
  const metricsSummary = useWorkspaceStore((state) => state.metricsSummary);
  const metricsLoading = useWorkspaceStore((state) => state.metricsLoading);
  const loadMetricsSummary = useWorkspaceStore((state) => state.loadMetricsSummary);
  const rootPath = useWorkspaceStore((state) => state.rootPath);

  const [preset, setPreset] = useState<PresetId>("today");
  const [customFrom, setCustomFrom] = useState(daysAgo(6));
  const [customTo, setCustomTo] = useState(isoDate(new Date()));

  useEffect(() => {
    void loadMetricsSummary();
  }, [loadMetricsSummary, rootPath]);

  const timeframe = useMemo(
    () => timeframeForPreset(preset, customFrom, customTo),
    [preset, customFrom, customTo],
  );

  const totals = useMemo(() => totalsForTimeframe(metricsSummary, timeframe), [metricsSummary, timeframe]);
  const byModel = useMemo(() => byModelForTimeframe(metricsSummary, timeframe), [metricsSummary, timeframe]);
  const byDay = useMemo(() => byDayForTimeframe(metricsSummary, timeframe), [metricsSummary, timeframe]);
  const hasUsage = totals.calls > 0;

  return (
    <div className="w-full h-full p-8 max-w-5xl mx-auto flex flex-col space-y-6 font-sans text-[var(--text-normal)] overflow-y-auto">
      <div className="flex items-center justify-between">
        <div className="flex flex-col space-y-1">
          <h2 className="text-2xl font-bold text-[var(--text-light)] flex items-center space-x-2">
            <Gauge className="text-[var(--accent-color)]" size={24} />
            <span>Token Metrics</span>
          </h2>
          <p className="text-xs text-[var(--text-muted)] font-mono">
            Track how many tokens you spend, per model and over time, across Agent Chat, sub-agents, canvas nodes, and reconciliation.
          </p>
        </div>
        <button
          onClick={() => void loadMetricsSummary()}
          className="flex items-center space-x-1.5 text-[10px] font-bold text-[var(--text-muted)] hover:text-[var(--text-light)] transition-colors px-2.5 py-1.5 rounded-lg border border-[var(--border-color)] hover:border-[var(--border-active)]"
        >
          <RefreshCw size={12} className={metricsLoading ? "animate-spin" : ""} />
          <span>Refresh</span>
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {PRESETS.map((item) => (
          <button
            key={item.id}
            onClick={() => setPreset(item.id)}
            className={`px-3 py-1.5 rounded-lg border text-xs font-bold transition-all ${
              preset === item.id
                ? "border-[var(--accent-color)] bg-[var(--accent-bg)]/20 text-[var(--accent-color)]"
                : "border-[var(--border-color)] bg-[var(--bg-app)]/50 text-[var(--text-muted)] hover:border-[var(--border-active)]"
            }`}
          >
            {item.label}
          </button>
        ))}
        {preset === "custom" && (
          <div className="flex items-center gap-2 ml-1">
            <input
              type="date"
              value={customFrom}
              max={customTo}
              onChange={(e) => setCustomFrom(e.target.value)}
              className="bg-[var(--bg-app)] border border-[var(--border-color)] rounded-lg px-2 py-1.5 text-xs text-[var(--text-light)] focus:border-[var(--accent-color)] focus:outline-none"
            />
            <span className="text-[var(--text-muted)] text-xs">to</span>
            <input
              type="date"
              value={customTo}
              min={customFrom}
              max={isoDate(new Date())}
              onChange={(e) => setCustomTo(e.target.value)}
              className="bg-[var(--bg-app)] border border-[var(--border-color)] rounded-lg px-2 py-1.5 text-xs text-[var(--text-light)] focus:border-[var(--accent-color)] focus:outline-none"
            />
          </div>
        )}
      </div>

      {!hasUsage ? (
        <Callout variant="info">
          No token usage recorded yet for this period. Usage is tracked automatically after each Agent Chat, sub-agent, node execution, or reconciliation run.
        </Callout>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <StatTile label="Total tokens" value={formatCompactTokenCount(totals.totalTokens)} />
            <StatTile label="Input" value={formatCompactTokenCount(totals.input)} />
            <StatTile label="Output" value={formatCompactTokenCount(totals.output)} />
            <StatTile label="Runs" value={String(totals.calls)} />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="bg-[var(--bg-sidebar)] border border-[var(--border-color)] rounded-xl p-4 space-y-3">
              <h3 className="text-xs font-bold text-[var(--text-muted)] uppercase tracking-wider font-mono">
                By model
              </h3>
              <div className="space-y-2">
                {byModel.map(({ model, totals: modelTotals }) => (
                  <div key={model} className="flex items-center justify-between gap-3 p-2.5 rounded-lg border border-[var(--border-color)] bg-[var(--bg-app)]/50">
                    <span className="text-xs font-bold text-[var(--text-light)] font-mono truncate" title={model}>
                      {model}
                    </span>
                    <span className="text-xs font-mono text-[var(--accent-color)] flex-shrink-0">
                      {formatCompactTokenCount(modelTotals.totalTokens)} tok
                    </span>
                  </div>
                ))}
              </div>
            </div>

            <div className="bg-[var(--bg-sidebar)] border border-[var(--border-color)] rounded-xl p-4 space-y-3">
              <h3 className="text-xs font-bold text-[var(--text-muted)] uppercase tracking-wider font-mono">
                By day
              </h3>
              {byDay.length === 0 ? (
                <p className="text-[10px] font-mono text-[var(--text-muted)] py-2">
                  Select a range or all-time view to see a day-by-day breakdown.
                </p>
              ) : (
                <div className="space-y-2">
                  {byDay.map(({ day, totals: dayTotals }) => (
                    <div key={day} className="flex items-center justify-between gap-3 p-2.5 rounded-lg border border-[var(--border-color)] bg-[var(--bg-app)]/50">
                      <span className="text-xs font-mono text-[var(--text-light)]">{day}</span>
                      <span className="text-xs font-mono text-[var(--accent-color)]">
                        {formatCompactTokenCount(dayTotals.totalTokens)} tok
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
};
