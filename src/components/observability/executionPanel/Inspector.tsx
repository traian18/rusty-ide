import { Activity, X } from "lucide-react";
import type { TimelineItem } from "../RunExecutionTimeline";
import styles from "../ToolExecutionPanel.module.css";
import { ExecutionDetail } from "./ExecutionDetail";
import { formatDuration, formatTime } from "./format";
import type { GroupedRun, TimelineToolItem } from "./groupedRun";
import { TEXT_KIND_VIEWS, TextItemDetail } from "./TextItemDetail";

const TITLE = "text-[var(--color-fg-strong)] font-mono text-sm";
const SUBTITLE = "text-[var(--color-fg-muted)] text-xs";

function ToolItemTitle({ item }: { item: TimelineToolItem }) {
  const running = item.record.status === "running";
  return (
    <>
      {running && <span className={`${styles.status} ${styles.status_running}`} />}
      <strong className={TITLE}>Execution Details: {item.record.toolName}</strong>
      <span className={SUBTITLE}>
        {running ? "Running · " : ""}
        {formatDuration(item.record)}
      </span>
    </>
  );
}

function ItemTitle({ item }: { item: TimelineItem }) {
  if (item.kind === "tool") return <ToolItemTitle item={item} />;
  const view = TEXT_KIND_VIEWS[item.kind];
  return (
    <>
      <view.icon size={15} className="text-[var(--color-primary)]" />
      <strong className={TITLE}>{view.label}</strong>
      <span className={SUBTITLE}>{formatTime(item.timestamp)}</span>
    </>
  );
}

function ItemDetail({ item, run }: { item: TimelineItem; run: GroupedRun }) {
  if (item.kind === "tool") return <ExecutionDetail record={item.record} runTokens={run.runTokens} runUsage={run.usage} />;
  return <TextItemDetail item={item} run={run} />;
}

/** The right-hand column: the selected timeline item's details, or a hint. */
export function Inspector({ selected, onDeselect }: { selected: { run: GroupedRun; item: TimelineItem } | null; onDeselect: () => void }) {
  return (
    <div className={styles.inspectorPanel} aria-label="Execution details inspector">
      {selected ? (
        <div>
          <div className={styles.inspectorHeader}>
            <div className="flex items-center gap-2">
              <ItemTitle item={selected.item} />
            </div>
            <button
              type="button"
              className={styles.iconButton}
              onClick={onDeselect}
              title="Deselect item"
              aria-label="Close inspector"
            >
              <X size={15} />
            </button>
          </div>
          <ItemDetail item={selected.item} run={selected.run} />
        </div>
      ) : (
        <div className={styles.inspectorEmpty}>
          <Activity size={32} className="text-[var(--color-fg-muted)] opacity-60" />
          <strong>No tool call selected</strong>
          <span>Click any tool call, assistant response, or reasoning step on the timeline to the left to inspect details, output, and run context.</span>
        </div>
      )}
    </div>
  );
}
