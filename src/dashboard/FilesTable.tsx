import { useEffect, useState } from "react";

import { toRepositoryError } from "../architecture/client";
import { Button, Callout } from "../components/ui";
import type { DashboardClient } from "./client";
import { ago, compact, percent } from "./format";
import { findingsTotal, type FileRow, type FilesQuery, type FilesSort } from "./model";
import styles from "./Dashboard.module.css";

const PAGE = 100;

const COLUMNS: { key: FilesSort | null; label: string; numeric?: boolean }[] = [
  { key: "path", label: "File" },
  { key: null, label: "Language" },
  { key: "lines", label: "Lines", numeric: true },
  { key: "importers", label: "Imported by", numeric: true },
  { key: "commits", label: "Commits", numeric: true },
  { key: null, label: "Main author" },
  { key: "findings", label: "Findings", numeric: true },
];

export interface FilesTableProps {
  client: DashboardClient;
  root: string;
  revision: number;
  /** The folder the map shows; the table lists what is under it. */
  path: string;
  languages: string[];
  query: FilesQuery;
  onQuery(query: FilesQuery): void;
  selected: string | null;
  onSelect(path: string): void;
}

/** Every file under the map's folder, filtered, sorted and paged by the host. */
export function FilesTable({ client, root, revision, path, languages, query, onQuery, selected, onSelect }: FilesTableProps) {
  const [rows, setRows] = useState<FileRow[]>([]);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [more, setMore] = useState(0);

  useEffect(() => {
    let live = true;
    setError(null);
    client.files(root, { ...query, path, offset: 0, limit: PAGE * (more + 1) }).then(
      (page) => {
        if (!live) return;
        setRows(page.rows);
        setTotal(page.total);
      },
      (failure) => live && setError(toRepositoryError(failure).message),
    );
    return () => {
      live = false;
    };
  }, [client, root, revision, path, query, more]);

  const sortBy = (key: FilesSort) => onQuery({ ...query, sort: key, descending: query.sort === key ? !query.descending : key !== "path" });

  return (
    <section aria-label="Files">
      <div className={styles.toolbar} role="search">
        <input aria-label="Filter by path" placeholder="Filter by path" value={query.text ?? ""} onChange={(event) => onQuery({ ...query, text: event.target.value || undefined })} />
        <select aria-label="Language" value={query.language ?? ""} onChange={(event) => onQuery({ ...query, language: event.target.value || undefined })}>
          <option value="">All languages</option>
          {languages.map((language) => (
            <option key={language} value={language}>
              {language}
            </option>
          ))}
        </select>
        <select aria-label="Changed" value={query.changedWithinDays ?? ""} onChange={(event) => onQuery({ ...query, changedWithinDays: event.target.value ? Number(event.target.value) : undefined })}>
          <option value="">Any time</option>
          <option value="30">Changed in 30 days</option>
          <option value="90">Changed in 90 days</option>
          <option value="365">Changed in a year</option>
        </select>
        <label className={styles.muted}>
          <input type="checkbox" checked={query.hasFindings === true} onChange={(event) => onQuery({ ...query, hasFindings: event.target.checked || undefined })} /> With findings
        </label>
        <label className={styles.muted}>
          <input type="checkbox" checked={query.tests === false} onChange={(event) => onQuery({ ...query, tests: event.target.checked ? false : undefined })} /> Hide tests
        </label>
        <span className={styles.spacer} />
        <span className={styles.muted} role="status">
          {rows.length < total ? `${rows.length} of ${total} files` : `${total} files`}
        </span>
      </div>
      {error ? <Callout variant="danger">{error}</Callout> : null}
      <table className={styles.table}>
        <thead>
          <tr>
            {COLUMNS.map((column) => (
              <th key={column.label} className={column.numeric ? styles.num : undefined} aria-sort={column.key && query.sort === column.key ? (query.descending ? "descending" : "ascending") : undefined}>
                {column.key ? (
                  <button type="button" className={styles.sortButton} onClick={() => sortBy(column.key!)}>
                    {column.label}
                    {query.sort === column.key ? (query.descending ? " ↓" : " ↑") : ""}
                  </button>
                ) : (
                  column.label
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.path} aria-selected={selected === row.path} onClick={() => onSelect(row.path)}>
              <td className={styles.path} title={row.path}>
                {row.path}
                {row.test ? <span className={styles.chip}> test</span> : null}
              </td>
              <td>{row.language}</td>
              <td className={styles.num}>{compact(row.lines)}</td>
              <td className={styles.num}>{row.importers}</td>
              <td className={styles.num} title={row.lastChange ? `last changed ${ago(row.lastChange)}` : undefined}>
                {row.commits}
              </td>
              <td>{row.owner ? `${row.owner}${row.ownerShare !== null ? ` ${percent(row.ownerShare)}` : ""}` : "–"}</td>
              <td className={styles.num}>
                {findingsTotal(row.findings) ? (
                  <>
                    <span className={`${styles.dot} ${row.findings.high ? styles.high : row.findings.medium ? styles.medium : styles.low}`} aria-hidden /> {findingsTotal(row.findings)}
                  </>
                ) : (
                  ""
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length < total ? (
        <Button variant="ghost" onClick={() => setMore((n) => n + 1)}>
          Show {Math.min(PAGE, total - rows.length)} more
        </Button>
      ) : null}
    </section>
  );
}
