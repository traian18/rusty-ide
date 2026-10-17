import { useAsyncData } from "./useAsyncData";
import type { ArchitectureClient } from "./client";
import type { FindingEntry, FindingsSummary, SnapshotSummary } from "./model";
import { SeverityPill } from "./SeverityPill";
import { SEVERITY_ORDER } from "./graphModel";
import styles from "./Architecture.module.css";

const TOP_FINDINGS = 3;

export interface SummaryStripProps {
  root: string;
  client: ArchitectureClient;
  revision: number;
  snapshot: SnapshotSummary;
  findings: FindingsSummary | null;
  /** Import cycles in the repository. */
  cycles: number;
  onOpenFindings(): void;
}

/** Counts and the top findings, taken from summaries already loaded; the only query is the top three. */
export function SummaryStrip({ root, client, revision, snapshot, findings, cycles, onOpenFindings }: SummaryStripProps) {
  const top = useAsyncData<FindingEntry[]>(`${root}:${revision}:top`, async () => (await client.findings(root, { limit: TOP_FINDINGS })).entries);
  const languages = snapshot.languages.join(", ") || "none";
  return (
    <div className={styles.strip} role="region" aria-label="Repository summary">
      <span className={styles.stat}><strong>{snapshot.packages}</strong> packages</span>
      <span className={styles.stat}><strong>{snapshot.files}</strong> files</span>
      <span className={styles.stat}><strong>{snapshot.imports}</strong> imports</span>
      <span className={styles.stat}><strong>{cycles}</strong> import cycle{cycles === 1 ? "" : "s"}</span>
      <span className={styles.stat}>{languages}</span>
      {findings ? (
        <span className={styles.toolbarGroup}>
          <strong>{findings.total}</strong> findings
          {SEVERITY_ORDER.filter((severity) => (findings.by_severity[severity] ?? 0) > 0).map((severity) => (
            <SeverityPill key={severity} severity={severity} count={findings.by_severity[severity] ?? 0} />
          ))}
        </span>
      ) : null}
      {top.status === "ready" && top.data.length ? (
        <span className={styles.toolbarGroup}>
          Top:
          {top.data.map((entry) => (
            <button key={entry.finding.id} type="button" className={styles.linkButton} onClick={onOpenFindings} title={entry.finding.summary}>
              {entry.finding.title}
            </button>
          ))}
        </span>
      ) : null}
    </div>
  );
}
