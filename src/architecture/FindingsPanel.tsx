import { useCallback, useEffect, useState } from "react";
import { Button, Callout } from "../components/ui";
import { toRepositoryError, type ArchitectureClient } from "./client";
import { SeverityPill } from "./SeverityPill";
import type { NavigationTarget } from "./navigation";
import type { Confidence, FindingEntry, FindingExplanation, FindingKind, RepositoryError, Severity } from "./model";
import styles from "./Architecture.module.css";

const PAGE = 25;

export interface FindingsPanelProps {
  root: string;
  client: ArchitectureClient;
  /** Changes when a new snapshot (and so a new finding set) arrives. */
  revision: number;
  onNavigate(target: NavigationTarget): void;
}

interface Filters {
  kind: FindingKind | "";
  severity: Severity | "";
  confidence: Confidence | "";
  includeSuppressed: boolean;
}

const NO_FILTERS: Filters = { kind: "", severity: "", confidence: "", includeSuppressed: false };

function ExplainedFinding({ explanation, onNavigate }: { explanation: FindingExplanation; onNavigate(target: NavigationTarget): void }) {
  const { finding } = explanation.entry;
  return (
    <div>
      <p>{finding.rationale}</p>
      {finding.interpretation ? <p className={styles.caveat}>{finding.interpretation}</p> : null}
      {explanation.rule_description ? <p className={styles.muted}>Rule {finding.rule.id} v{finding.rule.version}: {explanation.rule_description}</p> : null}
      {finding.locations.map((location, index) => (
        <div key={index}>
          <button
            className={styles.linkButton}
            onClick={() => onNavigate({ file: location.file, line: location.line, column: location.column, stale: location.stale })}
          >
            {location.file}
            {location.line ? `:${location.line}` : ""}
          </button>
          {location.stale ? <span className={styles.muted}> (file changed since analysis)</span> : null}
        </div>
      ))}
      {!explanation.repository_snapshot_available ? <p className={styles.muted}>Import sites could not be expanded because the snapshot was replaced.</p> : null}
    </div>
  );
}

export function FindingsPanel({ root, client, revision, onNavigate }: FindingsPanelProps) {
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const [entries, setEntries] = useState<FindingEntry[]>([]);
  const [cursor, setCursor] = useState<unknown | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<RepositoryError | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [explanation, setExplanation] = useState<FindingExplanation | null>(null);

  const load = useCallback(
    async (after: unknown | null) => {
      setLoading(true);
      try {
        const page = await client.findings(root, {
          kind: filters.kind || undefined,
          min_severity: filters.severity || undefined,
          min_confidence: filters.confidence || undefined,
          include_suppressed: filters.includeSuppressed,
          cursor: after ?? undefined,
          limit: PAGE,
        });
        setEntries((previous) => (after ? [...previous, ...page.entries] : page.entries));
        setCursor(page.next_cursor);
        setError(null);
      } catch (failure) {
        setError(toRepositoryError(failure));
      } finally {
        setLoading(false);
      }
    },
    [client, root, filters],
  );

  useEffect(() => {
    setOpen(null);
    void load(null);
  }, [load, revision]);

  const toggle = async (id: string) => {
    if (open === id) return setOpen(null);
    setOpen(id);
    setExplanation(null);
    try {
      setExplanation(await client.findingExplain(root, id));
    } catch (failure) {
      setError(toRepositoryError(failure));
    }
  };

  return (
    <div>
      <div className={styles.filters}>
        <select className={styles.control} aria-label="Finding kind" value={filters.kind} onChange={(e) => setFilters({ ...filters, kind: e.target.value as Filters["kind"] })}>
          <option value="">All kinds</option>
          <option value="measurable">Measurable</option>
          <option value="candidate">Candidates</option>
        </select>
        <select className={styles.control} aria-label="Minimum severity" value={filters.severity} onChange={(e) => setFilters({ ...filters, severity: e.target.value as Filters["severity"] })}>
          <option value="">Any severity</option>
          <option value="high">High</option>
          <option value="medium">Medium and up</option>
          <option value="low">Low and up</option>
        </select>
        <select className={styles.control} aria-label="Minimum confidence" value={filters.confidence} onChange={(e) => setFilters({ ...filters, confidence: e.target.value as Filters["confidence"] })}>
          <option value="">Any confidence</option>
          <option value="high">High</option>
          <option value="medium">Medium and up</option>
        </select>
        <label className={styles.checkbox}>
          <input type="checkbox" checked={filters.includeSuppressed} onChange={(e) => setFilters({ ...filters, includeSuppressed: e.target.checked })} />
          Suppressed
        </label>
      </div>
      {error ? <Callout variant={error.code === "snapshot_not_found" ? "info" : "danger"}>{error.message}</Callout> : null}
      {!error && !loading && entries.length === 0 ? <p className={styles.muted}>No findings match.</p> : null}
      <ul className={styles.list}>
        {entries.map(({ finding, suppressed_reason }) => (
          <li key={finding.id} className={styles.row}>
            <span className={styles.rowHeader}>
              <SeverityPill severity={finding.severity} />
              <button className={styles.linkButton} onClick={() => void toggle(finding.id)} aria-expanded={open === finding.id}>
                {finding.title}
              </button>
            </span>
            <span className={finding.kind === "candidate" ? styles.caveat : styles.muted}>
              {finding.kind === "candidate" ? `Candidate · ${finding.confidence} confidence` : `${finding.confidence} confidence`} · {finding.rule.id}
              {suppressed_reason ? ` · suppressed: ${suppressed_reason}` : ""}
            </span>
            <span>{finding.summary}</span>
            {open === finding.id ? (
              explanation && explanation.entry.finding.id === finding.id ? <ExplainedFinding explanation={explanation} onNavigate={onNavigate} /> : <span className={styles.muted}>Loading…</span>
            ) : null}
          </li>
        ))}
      </ul>
      {cursor ? (
        <Button onClick={() => void load(cursor)} loading={loading}>
          Load more
        </Button>
      ) : null}
    </div>
  );
}
