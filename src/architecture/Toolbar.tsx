import type { ReactNode } from "react";
import { ArrowLeft, FolderGit2, Loader2, RefreshCw, Square } from "lucide-react";
import { CompactSelect } from "../components/CompactSelect";
import { Button } from "../components/ui";
import { describeFreshness, staleSummary } from "./freshness";
import { MAX_SPACING, MIN_SPACING } from "./levels";
import type { ColorBy } from "./aggregate";
import type { Freshness } from "./model";
import type { ArchitectureViewState } from "./viewState";
import styles from "./Architecture.module.css";

export interface RepositoryChoice {
  options: { id: string; name: string }[];
  /** Worktree path of the repository being analysed. */
  active: string;
  onChange(worktreePath: string): void;
}

export interface ToolbarProps {
  view: ArchitectureViewState;
  /** Label of the group being drilled into, if any. */
  drillLabel: string | null;
  /** Goes up one folder; shown next to the label while a folder's files are open. */
  onUp(): void;
  builtAtMs: number | null;
  freshness: Freshness | null;
  refreshing: boolean;
  canRefresh: boolean;
  findingsTotal: number;
  /** Framework relations in the snapshot; the layer's checkbox is shown only when there are some. */
  frameworkRelations?: number;
  now: number;
  onRefresh(): void;
  onCancel(): void;
  /** Rendered next to the freshness line (the notices menu). */
  notices?: ReactNode;
  /** Shown only when the workspace holds more than one repository. */
  repositories?: RepositoryChoice;
}

export function Toolbar({ view, drillLabel, onUp, builtAtMs, freshness, refreshing, canRefresh, findingsTotal, frameworkRelations = 0, now, onRefresh, onCancel, notices, repositories }: ToolbarProps) {
  const report = describeFreshness(builtAtMs, now, freshness?.changed ?? [], freshness?.missing ?? []);
  const stale = report.state === "stale";
  return (
    <div className={styles.toolbar} role="toolbar" aria-label="Architecture controls">
      {repositories && repositories.options.length > 1 ? (
        <div className={styles.toolbarGroup}>
          <label htmlFor="architecture-repository" className={styles.muted}>
            Repository
          </label>
          <CompactSelect
            id="architecture-repository"
            value={repositories.active}
            onChange={repositories.onChange}
            options={repositories.options}
            placeholder="Select repository"
            icon={<FolderGit2 size={10} className="flex-shrink-0 mr-1" />}
          />
        </div>
      ) : null}
      {drillLabel !== null ? (
        <div className={styles.toolbarGroup}>
          <Button variant="ghost" icon={<ArrowLeft size={14} />} onClick={onUp}>
            Up
          </Button>
          <strong>{drillLabel}</strong>
        </div>
      ) : null}
      {drillLabel === null ? (
        <>
          <div className={styles.toolbarGroup}>
            <label htmlFor="architecture-colour" className={styles.muted}>
              Colour by
            </label>
            <CompactSelect
              id="architecture-colour"
              value={view.colorBy}
              onChange={(value) => view.setColorBy(value as ColorBy)}
              options={[
                { id: "node", name: "Each package" },
                { id: "language", name: "Language" },
                { id: "kind", name: "Kind" },
                { id: "severity", name: "Findings severity" },
              ]}
            />
          </div>
          <label className={styles.toolbarGroup}>
            <span className={styles.muted}>Edges</span>
            <input
              className={styles.range}
              type="range"
              min={20}
              max={100}
              step={10}
              value={view.edgeCoverage}
              onChange={(event) => view.setEdgeCoverage(Number(event.target.value))}
              aria-label="Share of import weight shown"
              aria-valuetext={`${view.edgeCoverage} percent of import weight`}
            />
            <span className={styles.muted}>{view.edgeCoverage}%</span>
          </label>
          <label className={styles.toolbarGroup}>
            <span className={styles.muted}>Spacing</span>
            <input
              className={styles.range}
              type="range"
              min={MIN_SPACING}
              max={MAX_SPACING}
              step={20}
              value={view.spacing}
              onChange={(event) => view.setSpacing(Number(event.target.value))}
              aria-label="Distance between nodes"
              aria-valuetext={`${view.spacing} percent`}
            />
          </label>
        </>
      ) : null}
      <div className={styles.toolbarGroup}>
        <label htmlFor="architecture-imports" className={styles.muted}>
          Imports
        </label>
        <CompactSelect
          id="architecture-imports"
          value={view.importKind}
          onChange={(value) => view.setImportKind(value as ArchitectureViewState["importKind"])}
          options={[
            { id: "all", name: "All" },
            { id: "runtime", name: "Runtime only" },
            { id: "type_only", name: "Type-only" },
          ]}
        />
      </div>
      <input
        className={`${styles.control} ${styles.search}`}
        type="search"
        placeholder={drillLabel !== null ? "Filter files…" : "Filter groups…"}
        value={view.search}
        onChange={(event) => view.setSearch(event.target.value)}
        aria-label="Filter"
      />
      <label className={styles.checkbox}>
        <input type="checkbox" checked={view.onlyWithFindings} onChange={(event) => view.setOnlyWithFindings(event.target.checked)} />
        With findings{findingsTotal ? ` (${findingsTotal})` : ""}
      </label>
      {frameworkRelations > 0 ? (
        <label className={styles.checkbox}>
          <input type="checkbox" checked={view.showFrameworks} onChange={(event) => view.setShowFrameworks(event.target.checked)} />
          Framework relations ({frameworkRelations})
        </label>
      ) : null}
      <span className={styles.toolbarSpacer} />
      {notices}
      <span className={`${styles.freshness} ${stale ? styles.freshnessStale : ""}`} role="status" aria-live="polite">
        {report.state === "none" ? "Not analyzed yet" : stale ? `Built ${report.builtAgo} · ${staleSummary(report)}` : `Built ${report.builtAgo}`}
      </span>
      {refreshing ? (
        <>
          <Loader2 size={14} className="animate-spin" aria-label="Analyzing" />
          <Button variant="ghost" icon={<Square size={12} />} onClick={onCancel}>
            Cancel
          </Button>
        </>
      ) : (
        <Button variant={stale || report.state === "none" ? "primary" : "secondary"} icon={<RefreshCw size={14} />} onClick={onRefresh} disabled={!canRefresh}>
          {report.state === "none" ? "Analyze" : "Refresh"}
        </Button>
      )}
    </div>
  );
}
