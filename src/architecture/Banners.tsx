import { useEffect, useRef, useState, type ReactNode } from "react";
import { AlertTriangle, Bell, Info, XCircle } from "lucide-react";
import { Button } from "../components/ui";
import type { FindingsSummary, FrameworksSummary, GitSummary, RepositoryError, SnapshotSummary, StageError, Truncation } from "./model";
import styles from "./Architecture.module.css";

export interface BannersProps {
  snapshot: SnapshotSummary | null;
  git: GitSummary | null;
  findings: FindingsSummary | null;
  stale: boolean;
  staleText: string;
  truncation: Truncation;
  loadError: RepositoryError | null;
  refreshError: RepositoryError | null;
  stageErrors: StageError[];
  documentWarning: string | null;
  navigationNotice: string | null;
  frameworks?: FrameworksSummary | null;
  onRefresh(): void;
  onLeaveDrill?(): void;
}

const TRUNCATION_TEXT: Record<Truncation, string | null> = {
  none: null,
  node_limit: "Showing the first part of a large graph (node limit). Filter or open a smaller group to see the rest.",
  edge_limit: "Some imports are not drawn (edge limit). Filter by import kind or open a smaller group.",
  depth_limit: "More imports exist beyond the depth shown.",
};

export type NoticeLevel = "error" | "warning" | "info";

export interface Notice {
  id: string;
  level: NoticeLevel;
  title: string;
  body: ReactNode;
  action?: { label: string; run(): void };
}

/** Everything the person should know about how complete and current the picture is, as a list. */
export function noticesFor(props: BannersProps, diagnostics: { open: boolean; toggle(): void }): Notice[] {
  const { snapshot, git, findings } = props;
  const skipped = findings?.skipped_rules ?? [];
  const truncated = TRUNCATION_TEXT[props.truncation];
  const notices: Notice[] = [];
  if (props.loadError) {
    notices.push({
      id: "load", level: "error", title: "Could not load this view", body: props.loadError.message,
      action: props.loadError.code === "unknown_group" && props.onLeaveDrill ? { label: "Back to overview", run: props.onLeaveDrill } : undefined,
    });
  }
  if (props.refreshError) notices.push({ id: "refresh", level: "error", title: "Analysis failed", body: `${props.refreshError.message} The previous results are still shown.` });
  if (props.stale) {
    notices.push({ id: "stale", level: "warning", title: "The repository changed since it was analyzed", body: `${props.staleText}. What you see may be out of date.`, action: { label: "Refresh", run: props.onRefresh } });
  }
  if (snapshot?.partial) {
    notices.push({
      id: "partial", level: "warning", title: "Partial coverage",
      body: (
        <>
          Some files could not be fully analyzed ({snapshot.diagnostics_total} diagnostic{snapshot.diagnostics_total === 1 ? "" : "s"}). Relationships may be missing.
          {diagnostics.open ? (
            <ul className={styles.diagnostics}>
              {snapshot.diagnostics.map((diagnostic, index) => (
                <li key={index}>
                  {diagnostic.path ? <code>{diagnostic.path}</code> : null} {diagnostic.message}
                </li>
              ))}
              {snapshot.diagnostics_total > snapshot.diagnostics.length ? <li>…and {snapshot.diagnostics_total - snapshot.diagnostics.length} more.</li> : null}
            </ul>
          ) : null}
        </>
      ),
      action: { label: diagnostics.open ? "Hide diagnostics" : "Show diagnostics", run: diagnostics.toggle },
    });
  }
  if (truncated) notices.push({ id: "truncated", level: "info", title: "Not everything is drawn", body: truncated });
  for (const error of props.stageErrors) {
    notices.push({ id: `stage:${error.stage}`, level: error.code === "not_a_git_repository" ? "info" : "warning", title: error.stage === "git" ? "Git history unavailable" : `${error.stage} step failed`, body: error.message });
  }
  if (git?.shallow) notices.push({ id: "shallow", level: "info", title: "Git history is shallow", body: "History-based facts cover only part of the project." });
  if (skipped.length) {
    notices.push({ id: "skipped", level: "info", title: `${skipped.length} finding rule${skipped.length === 1 ? " was" : "s were"} skipped`, body: skipped.map((s) => `${s.rule.id} (${s.reason})`).join("; ") });
  }
  const frameworks = props.frameworks;
  if (frameworks?.configured && frameworks.applications.length) {
    const names = [...new Set(frameworks.applications.map((a) => a.framework))].join(", ");
    notices.push({ id: "frameworks", level: "info", title: "Frameworks detected", body: `${names}: ${frameworks.relations} relation${frameworks.relations === 1 ? "" : "s"} read from declared dependencies and source. Turn on "Framework relations" to draw them.` });
  }
  if (frameworks && frameworks.diagnostics_total > 0) {
    notices.push({
      id: "framework-diagnostics", level: "warning", title: `${frameworks.diagnostics_total} framework convention${frameworks.diagnostics_total === 1 ? "" : "s"} could not be read`,
      body: (
        <ul className={styles.diagnostics}>
          {frameworks.diagnostics.map((diagnostic, index) => (
            <li key={index}>
              {diagnostic.path ? <code>{diagnostic.path}</code> : null} {diagnostic.message}
            </li>
          ))}
        </ul>
      ),
    });
  }
  if (props.documentWarning) notices.push({ id: "document", level: "warning", title: "Saved layout", body: props.documentWarning });
  if (props.navigationNotice) notices.push({ id: "navigation", level: "info", title: "Navigation", body: props.navigationNotice });
  return notices;
}

const ICON = { error: XCircle, warning: AlertTriangle, info: Info } as const;
const RANK: Record<NoticeLevel, number> = { error: 0, warning: 1, info: 2 };

/** A toolbar button with a count that opens the list of notices; nothing takes space until asked. */
export function NoticesMenu(props: BannersProps) {
  const [open, setOpen] = useState(false);
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false);
  const holder = useRef<HTMLDivElement>(null);
  const notices = noticesFor(props, { open: diagnosticsOpen, toggle: () => setDiagnosticsOpen((value) => !value) });

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent | KeyboardEvent) => {
      if (event instanceof KeyboardEvent ? event.key === "Escape" : !holder.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);

  if (!notices.length) return null;
  const worst = notices.reduce<NoticeLevel>((level, notice) => (RANK[notice.level] < RANK[level] ? notice.level : level), "info");
  const Icon = worst === "info" ? Bell : ICON[worst];
  const sorted = [...notices].sort((a, b) => RANK[a.level] - RANK[b.level]);
  return (
    <div className={styles.notices} ref={holder}>
      <button
        type="button"
        className={`${styles.noticesButton} ${styles[`notices_${worst}`]}`}
        aria-expanded={open}
        aria-haspopup="true"
        onClick={() => setOpen((value) => !value)}
      >
        <Icon size={14} aria-hidden /> Notices ({notices.length})
      </button>
      {open ? (
        <div className={styles.noticesPanel} role="region" aria-label="Notices">
          {sorted.map((notice) => {
            const NoticeIcon = ICON[notice.level];
            return (
              <div key={notice.id} className={`${styles.notice} ${styles[`notice_${notice.level}`]}`}>
                <div className={styles.noticeTitle}>
                  <NoticeIcon size={14} aria-hidden /> <strong>{notice.title}.</strong>
                </div>
                <div>{notice.body}</div>
                {notice.action ? (
                  <div className={styles.bannerActions}>
                    <Button variant={notice.id === "stale" ? "primary" : "ghost"} onClick={notice.action.run}>
                      {notice.action.label}
                    </Button>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
