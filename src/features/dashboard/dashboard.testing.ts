import { vi } from "vitest";

import { fakeClient } from "../architecture/testing";
import type { DashboardClient } from "./client";
import type { FileDetail, FileRow, MapLevel, Tile } from "./model";

const none = { high: 0, medium: 0, low: 0, info: 0 };

export const tile = (path: string, overrides: Partial<Tile> = {}): Tile => ({
  path,
  name: path.split("/").pop()!,
  folder: false,
  files: 1,
  lines: 100,
  languages: [["rust", 100]],
  commits: 2,
  dependents: 0,
  findings: none,
  singleOwner: false,
  tests: 0,
  ...overrides,
});

export const mapLevel = (path = ""): MapLevel => ({
  path,
  tiles: path ? [tile(`${path}/a.rs`, { lines: 300 }), tile(`${path}/b.rs`, { findings: { ...none, medium: 1 } })] : [tile("src", { folder: true, files: 2, lines: 400 }), tile("web", { folder: true, languages: [["typescript", 50]], lines: 50 })],
  merged: 0,
  languageRanks: ["rust", "typescript"],
  maxCommits: 4,
  total: tile(path || ".", { folder: true, files: 3, lines: 450 }),
});

export const row = (path: string, overrides: Partial<FileRow> = {}): FileRow => ({
  path,
  language: "rust",
  package: "app",
  lines: 6,
  importers: 2,
  imports: 1,
  dependents: 50,
  commits: 4,
  linesChanged: 8,
  contributors: 1,
  owner: "Alice",
  ownerShare: 1,
  lastChange: 1_700_000_000,
  findings: { ...none, medium: 1 },
  test: false,
  ...overrides,
});

export const detail = (): FileDetail => ({
  row: row("src/a.rs"),
  groups: ["src"],
  importers: [{ path: "src/c.rs", weight: 1 }],
  imports: [{ path: "src/b.rs", weight: 1 }],
  blastRadius: 2,
  findings: [
    {
      id: "import-cycle:1",
      rule: "import-cycle",
      title: "Import cycle between src/a.rs and src/b.rs",
      summary: "a.rs and b.rs import each other.",
      rationale: "Neither can be changed alone.",
      severity: "medium",
      confidence: "high",
      candidate: false,
      interpretation: null,
      lines: [1],
      otherFiles: ["src/b.rs"],
    },
  ],
  authors: [{ name: "Alice", commits: 4, share: 1 }],
  coChanged: [{ path: "src/b.rs", commits: 4, confidence: 1 }],
  firstChange: 1_700_000_000,
  page: "file:src/a.rs",
});

export function fakeDashboardClient(overrides: Partial<DashboardClient> = {}) {
  return {
    ...fakeClient(),
    allFiles: vi.fn(async () => ({ rows: [row("src/a.rs", { lines: 300 }), row("src/b.rs"), row("web/app.ts", { language: "typescript", lines: 50, findings: none })], languageRanks: ["rust", "typescript"] })),
    files: vi.fn(async () => ({ rows: [row("src/a.rs"), row("src/b.rs", { findings: none })], total: 2, offset: 0 })),
    file: vi.fn(async () => detail()),
    prompt: vi.fn(async (_root: string, file: string, finding?: string) => `## Target\n${file} ${finding ?? "all"}`),
    ...overrides,
  } as DashboardClient & Record<"allFiles" | "files" | "file" | "prompt", ReturnType<typeof vi.fn>>;
}
