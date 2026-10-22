// The Tool Execution Observability panel: runs (tool calls and streamed
// text on one timeline) on the left, the selected item's details on the
// right. Its parts live in ./executionPanel: the run model (groupedRun,
// runList), the item views (ExecutionDetail, TextItemDetail, Inspector),
// RunCard, and the panel's header and footer.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Database } from "lucide-react";
import { useTrajectories, type RunTrajectory } from "../../observability/trajectoryStore";
import type { ToolExecutionRecord, ToolExecutionStatus } from "../../observability/types";
import { useExecutionObservability } from "../../observability/useExecutionObservability";
import type { GroupedRun } from "./executionPanel/groupedRun";
import { Inspector } from "./executionPanel/Inspector";
import { PanelFilters, PanelHeader } from "./executionPanel/PanelHeader";
import { RunCard } from "./executionPanel/RunCard";
import { findSelected, groupRuns, runMatches, type RunCache } from "./executionPanel/runList";
import { StorageFooter } from "./executionPanel/StorageFooter";
import styles from "./ToolExecutionPanel.module.css";

export {
  runUsageTotal,
  type TimelineAssistantTextItem,
  type TimelineReasoningItem,
  type TimelineToolItem,
} from "./executionPanel/groupedRun";

/** Focuses the close button on open, and closes on Escape. */
function useCloseOnEscape(onClose: () => void) {
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    closeRef.current?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, [onClose]);
  return closeRef;
}

/** The runs, rebuilt only where their trajectory or records changed. */
function useGroupedRuns(records: ToolExecutionRecord[], trajectories: RunTrajectory[]): GroupedRun[] {
  const cache = useRef<RunCache>(new Map());
  return useMemo(() => {
    const { runs, cache: next } = groupRuns(records, trajectories, cache.current);
    cache.current = next;
    return runs;
  }, [records, trajectories]);
}

interface RunListProps {
  runs: GroupedRun[];
  activeRunId?: string;
  selectedItemId: string | null;
  onSelectItem: (id: string) => void;
}

function RunList({ runs, activeRunId, selectedItemId, onSelectItem }: RunListProps) {
  if (runs.length === 0) {
    return (
      <div className={styles.empty}>
        <Database size={28} />
        <strong>No execution runs found</strong>
        <span>Executions will appear here as agents run tools and stream responses.</span>
      </div>
    );
  }
  return (
    <>
      {runs.map((run) => {
        const active = activeRunId === run.runId;
        return (
          <RunCard
            key={run.runId}
            run={run}
            active={active}
            selectedItemId={active ? selectedItemId : null}
            onSelectItem={onSelectItem}
          />
        );
      })}
    </>
  );
}

export function ToolExecutionPanel({ onClose }: { onClose: () => void }) {
  const snapshot = useExecutionObservability();
  const trajectorySnapshot = useTrajectories();
  const [status, setStatus] = useState<"all" | ToolExecutionStatus>("all");
  const [surface, setSurface] = useState("all");
  const [query, setQuery] = useState("");
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const closeRef = useCloseOnEscape(onClose);
  const groupedRuns = useGroupedRuns(snapshot.records, trajectorySnapshot.runs);

  const filteredRuns = useMemo(() => {
    const filters = { status, surface, needle: query.trim().toLowerCase() };
    return groupedRuns.filter((run) => runMatches(run, filters));
  }, [groupedRuns, query, status, surface]);
  const selectedInfo = useMemo(() => findSelected(groupedRuns, selectedItemId), [groupedRuns, selectedItemId]);
  const handleSelectItem = useCallback((itemId: string) => {
    setSelectedItemId((prev) => (prev === itemId ? null : itemId));
  }, []);

  return (
    <div
      className={styles.panelOverlay}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <aside id="tool-execution-panel" className={styles.panel} role="dialog" aria-modal="true" aria-label="Tool execution">
        <PanelHeader callCount={snapshot.records.length} runCount={groupedRuns.length} closeRef={closeRef} onClose={onClose} />
        <PanelFilters
          records={snapshot.records}
          query={query}
          onQuery={setQuery}
          status={status}
          onStatus={setStatus}
          surface={surface}
          onSurface={setSurface}
        />

        {snapshot.lastError && (
          <div className={styles.storageError}>History storage degraded: {snapshot.lastError}</div>
        )}

        {/* Unified Per-Execution View: Stacked Run Charts on Left, Inspector on Right */}
        <div className={styles.runsDashboard}>
          <div className={styles.runsOverview} aria-live="polite">
            <RunList runs={filteredRuns} activeRunId={selectedInfo?.run.runId} selectedItemId={selectedItemId} onSelectItem={handleSelectItem} />
          </div>
          <Inspector selected={selectedInfo} onDeselect={() => setSelectedItemId(null)} />
        </div>

        <StorageFooter snapshot={snapshot} runCount={groupedRuns.length} />
      </aside>
    </div>
  );
}
