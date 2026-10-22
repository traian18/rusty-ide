import { useEffect, useState } from "react";
import { Trash2 } from "lucide-react";
import { executionObservability } from "../../../observability/executionStore";
import type { ObservabilitySnapshot } from "../../../observability/types";
import { useWorkspaceStore, type UsageTotals } from "../../../store";
import { usageMetricsService } from "../../../services/usageMetricsService";
import { CustomSelect } from "../../CustomSelect";
import styles from "../ToolExecutionPanel.module.css";
import { describeTotals, formatBytes, formatTokens } from "./format";

const RETENTION_OPTIONS = [
  { id: "7", name: "7 days" },
  { id: "30", name: "30 days" },
  { id: "90", name: "90 days" },
  { id: "unlimited", name: "All" },
];

const CLEAR_CONFIRMATION = "Permanently delete this workspace's saved execution history and run trajectories from .rusty/observability? Active runs will be kept. Token usage totals are not affected.";

function AllTimeUsage({ refreshKey }: { refreshKey: number }) {
  const rootPath = useWorkspaceStore((state) => state.rootPath);
  const rusty = useWorkspaceStore((state) => state.metricsSummary?.allTime.total);
  const loadMetricsSummary = useWorkspaceStore((state) => state.loadMetricsSummary);
  const [claudeCode, setClaudeCode] = useState<UsageTotals | null>(null);

  useEffect(() => {
    void loadMetricsSummary();
    if (!rootPath) return;
    let cancelled = false;
    void usageMetricsService.loadClaudeCodeTotals(rootPath).then((totals) => { if (!cancelled) setClaudeCode(totals); });
    return () => { cancelled = true; };
  }, [rootPath, loadMetricsSummary, refreshKey]);

  if (!rusty && !claudeCode) return null;
  return (
    <div className={styles.usageTotals} aria-label="All-time token usage">
      <strong>All-time tokens</strong>
      {rusty && <span title={describeTotals(rusty)}>Rusty agents: {formatTokens(rusty.totalTokens)} · {describeTotals(rusty)}</span>}
      {claudeCode && <span title={describeTotals(claudeCode)}>Claude Code: {formatTokens(claudeCode.totalTokens)} · {describeTotals(claudeCode)}</span>}
    </div>
  );
}

/** Where history is kept, how much of it is shown, and clearing it. */
export function StorageFooter({ snapshot, runCount }: { snapshot: ObservabilitySnapshot; runCount: number }) {
  return (
    <div className={styles.storageFooter}>
      <div>
        <strong>History on disk</strong>
        <span title="Saved under .rusty/observability in this workspace; limited only by disk space">
          {snapshot.records.length} calls across {runCount} executions shown · .rusty/observability · {formatBytes(snapshot.storageBytes)}
        </span>
      </div>
      <AllTimeUsage refreshKey={snapshot.records.length} />
      <label className="flex items-center gap-1.5 text-[var(--color-fg-muted)] font-mono text-[var(--font-size-ui-xs)]">
        <span>Show</span>
        <CustomSelect
          value={String(snapshot.retentionDays ?? "unlimited")}
          onChange={(val) =>
            void executionObservability.setRetention(
              val === "unlimited" ? null : (Number(val) as 7 | 30 | 90)
            )
          }
          options={RETENTION_OPTIONS}
          direction="up"
          className="w-28"
        />
      </label>
      <button
        type="button"
        className={styles.dangerButton}
        onClick={() => {
          if (window.confirm(CLEAR_CONFIRMATION)) {
            void executionObservability.clear();
          }
        }}
      >
        <Trash2 size={14} /> Clear history
      </button>
    </div>
  );
}
