import { memo, useEffect, useMemo, useRef, useState } from "react";

import { compact } from "./format";
import { fill, type Lens } from "./lenses";
import type { FileRow, MapLevel, Tile } from "./model";
import { nestedTreemap } from "./nestedTreemap";
import { pathTree } from "./pathTree";
import styles from "./Dashboard.module.css";

/** Used before the map has been measured, and where nothing can measure it (tests). */
const FALLBACK = { w: 960, h: 576 };
/** A file cell gets its name when it has this much room. */
const LABEL_W = 56;
const LABEL_H = 16;
const SINGLE_OWNER_SHARE = 0.8;

/** One file as a map tile, so the lenses paint files and folders alike. */
export function fileTile(row: FileRow): Tile {
  return {
    path: row.path,
    name: row.path.split("/").pop() ?? row.path,
    folder: false,
    files: 1,
    lines: row.lines,
    languages: [[row.language, row.lines]],
    commits: row.commits,
    dependents: row.dependents,
    findings: row.findings,
    singleOwner: (row.ownerShare ?? 0) >= SINGLE_OWNER_SHARE && row.commits >= 3,
    tests: row.test ? 1 : 0,
  };
}

function describe(tile: Tile, lens: Lens): string {
  const base = `${tile.path}: ${compact(tile.lines)} lines`;
  switch (lens) {
    case "language":
      return `${base}, ${tile.languages[0]?.[0] ?? "no language"}`;
    case "churn":
      return `${base}, ${tile.commits} commits`;
    case "dependents":
      return `${base}, dependents percentile ${tile.dependents}`;
    case "findings":
      return `${base}, findings ${tile.findings.high} high, ${tile.findings.medium} medium, ${tile.findings.low + tile.findings.info} low`;
    case "owner":
      return `${base}${tile.singleOwner ? ", one main author" : ""}`;
  }
}

export interface ProjectMapProps {
  rows: FileRow[];
  /** What the lenses scale against: the repository's language order and its busiest file. */
  scale: Pick<MapLevel, "languageRanks" | "maxCommits">;
  lens: Lens;
  sizeBy: "lines" | "files";
  selected: string | null;
  /** The folder the table below is narrowed to, outlined on the map. */
  folder: string;
  onSelectFile(path: string): void;
  onSelectFolder(path: string): void;
}

/** Every file of the repository in one treemap, framed by folder and painted by the lens. */
export const ProjectMap = memo(function ProjectMap({ rows, scale, lens, sizeBy, selected, folder, onSelectFile, onSelectFolder }: ProjectMapProps) {
  const box = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState(FALLBACK);
  useEffect(() => {
    const element = box.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      if (width > 0 && height > 0) setSize({ w: width, h: height });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const tiles = useMemo(() => rows.map(fileTile), [rows]);
  const layout = useMemo(() => {
    const tree = pathTree(tiles, (t) => t.path, (t) => (sizeBy === "files" ? 1 : Math.max(t.lines, 1)));
    return nestedTreemap(tree, { x: 0, y: 0, w: size.w, h: size.h });
  }, [tiles, sizeBy, size]);
  return (
    <div
      ref={box}
      className={`${styles.map} ${styles.projectMap}`}
      role="group"
      aria-label="Map of every file in the repository"
      onClick={(event) => {
        const target = (event.target as HTMLElement).closest<HTMLElement>("[data-file],[data-folder]");
        if (target?.dataset.file) onSelectFile(target.dataset.file);
        else if (target?.dataset.folder !== undefined) onSelectFolder(target.dataset.folder === folder ? "" : target.dataset.folder);
      }}
    >
      {layout.frames.map(({ node, depth, labelled, x, y, w, h }) => (
        <div key={`d:${node.path}`} className={styles.frame} data-depth={Math.min(depth, 3)} aria-current={folder === node.path ? "true" : undefined} style={{ left: x, top: y, width: w, height: h }}>
          {labelled ? (
            <button type="button" className={styles.frameLabel} data-folder={node.path} title={`${node.path}: ${node.files} files, ${compact(node.weight)} ${sizeBy}. Click to list them below.`}>
              {node.name}
            </button>
          ) : null}
        </div>
      ))}
      {layout.cells.map(({ item: tile, x, y, w, h }) => (
        <div
          key={tile.path}
          className={styles.cell}
          data-file={tile.path}
          title={describe(tile, lens)}
          style={{ left: x, top: y, width: w, height: h, background: fill(lens, tile, scale), outline: selected === tile.path ? "2px solid var(--color-focus-ring)" : undefined }}
        >
          {w >= LABEL_W && h >= LABEL_H ? <span className={styles.cellLabel}>{tile.name}</span> : null}
        </div>
      ))}
    </div>
  );
});
