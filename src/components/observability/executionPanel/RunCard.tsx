import { memo, useState } from "react";
import type { TrajectoryEntry } from "../../../observability/trajectoryStore";
import type { RunUsage } from "../../../observability/types";
import { RunExecutionTimeline } from "../RunExecutionTimeline";
import styles from "../ToolExecutionPanel.module.css";
import { formatTime } from "./format";
import type { GroupedRun } from "./groupedRun";

/** Statuses that get a badge on the run card; the others go without. */
const STATUS_BADGES: Partial<Record<GroupedRun["status"], string>> = {
  running: "Running",
  cancelled: "Cancelled",
};

/** One line per model for the token count's tooltip. */
function usageTooltip(usage: RunUsage | undefined): string | undefined {
  const lines = Object.values(usage ?? {}).map((entry) => {
    const role = entry.role === "run" ? "" : ` (${entry.purpose ?? entry.role})`;
    return `${entry.model}${role}: ${(entry.tokens.totalTokens ?? 0).toLocaleString()}`;
  });
  return lines.join("\n") || undefined;
}

function RunIdentity({ run }: { run: GroupedRun }) {
  const badge = STATUS_BADGES[run.status];
  return (
    <div className={styles.runIdentity}>
      {badge && (
        <span className={`${styles.runStatusBadge} ${styles[`runStatus_${run.status}`]}`}>
          {badge}
        </span>
      )}
      <strong className={styles.runPromptPreview} title={run.requestPrompt || run.originLabel}>
        {run.requestPrompt ? `"${run.requestPrompt}"` : run.originLabel}
      </strong>
      {run.capability && <span className={styles.runMetaPill}>{run.capability}</span>}
      {run.model && <span className={styles.runMetaPill}>{run.model}</span>}
      <span className={styles.runMetaPill}>{run.surface}</span>
    </div>
  );
}

function RunStats({ run }: { run: GroupedRun }) {
  return (
    <div className={styles.runStats}>
      <span>{formatTime(run.startedAt)}</span>
      <span>{run.records.length} {run.records.length === 1 ? "call" : "calls"}</span>
      {run.durationMs !== undefined && <span>{(run.durationMs / 1000).toFixed(1)}s</span>}
      {run.totalTokens !== undefined && (
        <span title={usageTooltip(run.usage)}>
          {run.totalTokens.toLocaleString()} tok
        </span>
      )}
    </div>
  );
}

/** Re-renders only when its own run, selection, or active state changes, so
 * a streaming session doesn't re-render every other run on each update. */
export const RunCard = memo(function RunCard({
  run,
  active,
  selectedItemId,
  onSelectItem,
}: {
  run: GroupedRun;
  active: boolean;
  selectedItemId: string | null;
  onSelectItem: (id: string) => void;
}) {
  return (
    <article className={`${styles.runCard} ${active ? styles.runCardActive : ""}`}>
      <div className={styles.runCardHeader}>
        <RunIdentity run={run} />
        <RunStats run={run} />
      </div>

      {/* Horizontal Time Series Execution Chart */}
      <RunExecutionTimeline
        items={run.timelineItems}
        selectedItemId={selectedItemId}
        onSelectItem={onSelectItem}
        runStartedAt={run.startedAt}
      />

      {/* Inline Collapsible Event Trace */}
      {run.entries.length > 0 && <RunTrace entries={run.entries} />}
    </article>
  );
});

/** The raw event trace: nothing is rendered until it is opened, and each
 * payload is formatted only when its own entry is expanded. */
function RunTrace({ entries }: { entries: TrajectoryEntry[] }) {
  const [open, setOpen] = useState(false);
  return (
    <details className={styles.runTraceDetails} onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary>Event Trace ({entries.length} raw events)</summary>
      {open && (
        <div className={styles.runTraceList}>
          {entries.map((entry, index) => <TraceEntry key={entry.id} entry={entry} index={index} />)}
        </div>
      )}
    </details>
  );
}

function TraceEntry({ entry, index }: { entry: TrajectoryEntry; index: number }) {
  const [open, setOpen] = useState(false);
  return (
    <details className={styles.trajectoryEntry} onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary>
        <span>{entry.sequence ?? index + 1} · {entry.source}</span>
        <small>{formatTime(entry.timestamp)} · {entry.payloadState}</small>
      </summary>
      {open && (
        <div className={styles.detail}>
          {entry.agentId && <p className="text-xs text-[var(--color-fg-muted)] m-0">Agent: {entry.agentId}</p>}
          {(entry.eventCount ?? 0) > 1 && (
            <p className="text-xs text-[var(--color-fg-muted)] m-0">
              {entry.eventCount} streamed chunks grouped in order
            </p>
          )}
          <pre className={styles.code}>{JSON.stringify(entry.payload, null, 2)}</pre>
        </div>
      )}
    </details>
  );
}
