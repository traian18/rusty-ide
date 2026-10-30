/** What the dashboard commands return (camelCase, as the host serializes it). */
export interface SeverityCounts {
  high: number;
  medium: number;
  low: number;
  info: number;
}

export interface Tile {
  path: string;
  name: string;
  folder: boolean;
  files: number;
  lines: number;
  languages: [string, number][];
  commits: number;
  dependents: number;
  findings: SeverityCounts;
  singleOwner: boolean;
  tests: number;
}

export interface MapLevel {
  path: string;
  tiles: Tile[];
  merged: number;
  languageRanks: string[];
  maxCommits: number;
  total: Tile;
}

/** Every file at once, for the whole-project map. */
export interface MapFiles {
  rows: FileRow[];
  languageRanks: string[];
}

export type FilesSort = "path" | "lines" | "commits" | "importers" | "findings";

export interface FilesQuery {
  path?: string;
  language?: string;
  text?: string;
  hasFindings?: boolean;
  changedWithinDays?: number;
  tests?: boolean;
  sort?: FilesSort;
  descending?: boolean;
  offset?: number;
  limit?: number;
}

export interface FileRow {
  path: string;
  language: string;
  package: string | null;
  lines: number;
  importers: number;
  imports: number;
  dependents: number;
  commits: number;
  linesChanged: number;
  contributors: number;
  owner: string | null;
  ownerShare: number | null;
  lastChange: number | null;
  findings: SeverityCounts;
  test: boolean;
}

export interface FilesPage {
  rows: FileRow[];
  total: number;
  offset: number;
}

export interface FileFinding {
  id: string;
  rule: string;
  title: string;
  summary: string;
  rationale: string;
  severity: string;
  confidence: string;
  candidate: boolean;
  interpretation: string | null;
  lines: number[];
  otherFiles: string[];
}

export interface FileDetail {
  row: FileRow;
  groups: string[];
  importers: { path: string; weight: number }[];
  imports: { path: string; weight: number }[];
  blastRadius: number;
  findings: FileFinding[];
  authors: { name: string; commits: number; share: number }[];
  coChanged: { path: string; commits: number; confidence: number }[];
  firstChange: number | null;
  page: string;
}

export const findingsTotal = (counts: SeverityCounts) => counts.high + counts.medium + counts.low + counts.info;
