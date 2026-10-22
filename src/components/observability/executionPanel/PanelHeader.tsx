import { useMemo, type RefObject } from "react";
import { Activity, X } from "lucide-react";
import type { ToolExecutionRecord, ToolExecutionStatus } from "../../../observability/types";
import { CustomSelect } from "../../CustomSelect";
import styles from "../ToolExecutionPanel.module.css";

const STATUS_LABEL: Record<ToolExecutionStatus, string> = {
  queued: "Queued",
  "waiting-permission": "Needs permission",
  running: "Running",
  succeeded: "Succeeded",
  failed: "Failed",
  cancelled: "Cancelled",
};

const STATUS_OPTIONS = [
  { id: "all", name: "All statuses" },
  ...Object.entries(STATUS_LABEL).map(([value, label]) => ({ id: value, name: label })),
];

export function PanelHeader({ callCount, runCount, closeRef, onClose }: { callCount: number; runCount: number; closeRef: RefObject<HTMLButtonElement | null>; onClose: () => void }) {
  return (
    <div className={styles.panelHeader}>
      <div>
        <h2>
          <Activity size={18} className="text-[var(--color-primary)]" />
          Tool Execution Observability
        </h2>
        <p>
          {callCount} calls across {runCount} executions · Timeline view per run
        </p>
      </div>
      <div className={styles.headerActions}>
        <button ref={closeRef} type="button" className={styles.iconButton} aria-label="Close tool execution" onClick={onClose}>
          <X size={18} />
        </button>
      </div>
    </div>
  );
}

interface PanelFiltersProps {
  records: ToolExecutionRecord[];
  query: string;
  onQuery: (query: string) => void;
  status: "all" | ToolExecutionStatus;
  onStatus: (status: "all" | ToolExecutionStatus) => void;
  surface: string;
  onSurface: (surface: string) => void;
}

export function PanelFilters({ records, query, onQuery, status, onStatus, surface, onSurface }: PanelFiltersProps) {
  const surfaceOptions = useMemo(
    () => [
      { id: "all", name: "All sources" },
      ...[...new Set(records.map((record) => record.origin.surface))].map((value) => ({ id: value, name: value })),
    ],
    [records],
  );
  return (
    <div className={styles.filters}>
      <input
        value={query}
        onChange={(event) => onQuery(event.target.value)}
        placeholder="Search prompts, tools, responses, arguments, results and errors..."
        aria-label="Search execution history"
      />
      <CustomSelect
        value={status}
        onChange={(val) => onStatus(val as typeof status)}
        options={STATUS_OPTIONS}
        placeholder="All statuses"
        className="w-36"
      />
      <CustomSelect
        value={surface}
        onChange={(val) => onSurface(val)}
        options={surfaceOptions}
        placeholder="All sources"
        className="w-36"
      />
    </div>
  );
}
