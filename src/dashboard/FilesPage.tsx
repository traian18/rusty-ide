import { X } from "lucide-react";
import { useCallback, useMemo } from "react";

import { Callout } from "../components/ui";
import type { DashboardClient } from "./client";
import { useDashboard } from "./dashboardState";
import { FilesTable } from "./FilesTable";
import { compact } from "./format";
import { legend, LENSES } from "./lenses";
import { ProjectMap } from "./ProjectMap";
import { useLoad } from "./useLoad";
import styles from "./Dashboard.module.css";

export interface FilesPageProps {
  client: DashboardClient;
  root: string;
  revision: number;
}

/** How the code is distributed: every file of the repository in one map, framed by folder, and the files table under it. */
export function FilesPage({ client, root, revision }: FilesPageProps) {
  const { folder, lens, sizeBy, filters, selected, setFolder, setLens, setSizeBy, setFilters, select } = useDashboard();
  const { value: files, error } = useLoad(() => client.allFiles(root), [client, root, revision]);
  const scale = useMemo(() => ({ languageRanks: files?.languageRanks ?? [], maxCommits: files ? Math.max(0, ...files.rows.map((r) => r.commits)) : 0 }), [files]);
  const lines = useMemo(() => files?.rows.reduce((sum, r) => sum + r.lines, 0) ?? 0, [files]);
  const selectFile = useCallback((path: string) => select(path), [select]);

  return (
    <article aria-label="Files">
      <div className={styles.toolbar}>
        {files ? (
          <span className={styles.muted}>
            {files.rows.length} files · {compact(lines)} lines
          </span>
        ) : null}
        <span className={styles.spacer} />
        <div role="radiogroup" aria-label="Colour by" className={styles.toolbar} style={{ margin: 0 }}>
          {LENSES.map((option) => (
            <button key={option.id} type="button" role="radio" aria-checked={lens === option.id} title={option.hint} className={styles.navItem} aria-current={lens === option.id ? "page" : undefined} onClick={() => setLens(option.id)}>
              {option.name}
            </button>
          ))}
        </div>
        <select aria-label="Size by" value={sizeBy} onChange={(event) => setSizeBy(event.target.value as "lines" | "files")}>
          <option value="lines">Size: lines</option>
          <option value="files">Size: files</option>
        </select>
      </div>
      {error ? <Callout variant="danger">{error}</Callout> : null}
      {files ? (
        <>
          <ProjectMap rows={files.rows} scale={scale} lens={lens} sizeBy={sizeBy} selected={selected} folder={folder} onSelectFile={selectFile} onSelectFolder={setFolder} />
          <div className={styles.legend} aria-label="Legend">
            {legend(lens, scale).map((row) => (
              <span key={row.label}>
                <span className={styles.swatch} style={{ background: row.color }} aria-hidden />
                {row.label}
              </span>
            ))}
            <span>· click a folder name to list its files below</span>
          </div>
          {folder ? (
            <div className={styles.toolbar}>
              <span className={styles.muted}>Files under</span>
              <strong>{folder}/</strong>
              <button type="button" className={styles.link} aria-label="Show every file" onClick={() => setFolder("")}>
                <X size={12} aria-hidden /> all files
              </button>
            </div>
          ) : null}
          <FilesTable client={client} root={root} revision={revision} path={folder} languages={files.languageRanks} query={filters} onQuery={setFilters} selected={selected} onSelect={select} />
        </>
      ) : !error ? (
        <div role="status">Loading…</div>
      ) : null}
    </article>
  );
}
