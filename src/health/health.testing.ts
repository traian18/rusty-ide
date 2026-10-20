import { vi } from "vitest";

import type { HealthClient } from "./client";
import type { HealthFileDetail, HealthReport, TrendView } from "./model";

const counts = (medium = 0, high = 0) => ({ critical: 0, high, medium, low: 0 });

export const report = (): HealthReport => ({
  snapshot: "snap",
  repository: {
    average: 6.42,
    band: "fair",
    hotspot_health: 5.1,
    maintainability_average: 7.3,
    maintainability_hotspot: 6.0,
    production_average: 6.4,
    structure_average: 2.1,
    history_average: 0.6,
    structure_hotspot: 3,
    history_hotspot: 1.2,
    worst_file: { path: "src/tangled.rs", score: 3.2 },
    worst_test: null,
    file_count: 3,
    production_file_count: 3,
    hotspot_count: 1,
    unanalysed_count: 1,
    analysed_per_mille: 750,
    distribution: [
      { band: "at_risk", files: 1, nloc: 200, nloc_per_mille: 500 },
      { band: "needs_work", files: 0, nloc: 0, nloc_per_mille: 0 },
      { band: "fair", files: 0, nloc: 0, nloc_per_mille: 0 },
      { band: "good", files: 1, nloc: 100, nloc_per_mille: 250 },
      { band: "excellent", files: 1, nloc: 100, nloc_per_mille: 250 },
    ],
  },
  selfCheck: null,
  files: [
    { path: "src/tangled.rs", language: "rust", nloc: 200, test: false, hotspot: true, defect: 3.2, maintainability: 4.1, band: "at_risk", structure: 5.6, history: 1.2, findings: counts(1, 2), topIssue: "`route` nests control blocks 7 deep (limit 4)" },
    { path: "src/ok.rs", language: "rust", nloc: 100, test: false, hotspot: false, defect: 7.5, maintainability: 8, band: "good", structure: 2.5, history: 0, findings: counts(1), topIssue: null },
    { path: "web/a.ts", language: "typescript", nloc: 100, test: false, hotspot: false, defect: 10, maintainability: 10, band: "excellent", structure: 0, history: 0, findings: counts(), topIssue: null },
    { path: "x.go", language: "go", nloc: 0, test: false, hotspot: false, defect: null, maintainability: null, band: null, structure: 0, history: 0, findings: counts(), topIssue: null },
  ],
  folders: [{ path: "src", files: 2, nloc: 300, average: 4.6, band: "needs_work", worst_decile: 3.2, worst_file: { path: "src/tangled.rs", score: 3.2 }, hotspots: 1, unanalysed: 0 }],
  detectors: [{ id: "nested_complexity", category: "structural_complexity", summary: "Functions with deeply nested control blocks.", files: 1, findings: counts(0, 1), examples: ["src/tangled.rs"] }],
  findings: 4,
  history: true,
  languagesMeasured: ["rust", "typescript"],
});

export const detail = (): HealthFileDetail => ({
  row: report().files[0],
  findings: [
    {
      id: "nested_complexity:src/tangled.rs:1:route",
      detector: "nested_complexity",
      detector_version: 1,
      category: "structural_complexity",
      severity: "critical",
      path: "src/tangled.rs",
      function: "route",
      class: null,
      start_line: 1,
      end_line: 20,
      measured: { max_nesting: 7, limit: 4 },
      reason: "`route` nests control blocks 7 deep (limit 4); pull the inner blocks into functions or return early.",
      impact: 2.5,
    },
    {
      id: "change_entropy:src/tangled.rs:1:",
      detector: "change_entropy",
      detector_version: 1,
      category: "organizational",
      severity: "high",
      path: "src/tangled.rs",
      function: null,
      class: null,
      start_line: 1,
      end_line: 1,
      measured: { percentile: 920 },
      reason: "Changes to this file are more scattered than 92% of the repository's files.",
      impact: 1.2,
    },
  ],
  defectCategories: { structural_complexity: { raw: 2.68, cap: 2.5, applied: 2.5 }, organizational: { raw: 1.81, cap: 3.5, applied: 1.2 } },
  maintainabilityCategories: {},
  unclamped: 3.2,
  functions: [{ name: "route", startLine: 1, endLine: 20, nloc: 19, ccn: 12, cognitive: 20, maxNesting: 7, params: 4 }],
  importers: 3,
  signals: { commits: 9, commits_recent: 4, fix_commits: 2, hotspot: true, contributors: 2, owner: { name: "Alice" }, owner_share_per_mille: 700 },
  target: 8,
});

export const trend = (): TrendView => ({
  points: [
    { at_ms: 1_000, commit: "a1", backfilled: true, digest: "d", score: 6, structure_score: 6.5, maintainability: 7.0, findings: 20, severities: { critical: 0, high: 2, medium: 8, low: 10 }, scored_files: 30, nloc: 3000, top_detectors: [["large_method", 6]], regressions: [], improvements: [] },
    { at_ms: 2_000, commit: "b2", backfilled: true, digest: "d", score: 5.5, structure_score: 6, maintainability: 6.4, findings: 26, severities: { critical: 0, high: 4, medium: 10, low: 12 }, scored_files: 32, nloc: 3400, top_detectors: [["large_method", 9]], regressions: [], improvements: [] },
    { at_ms: 3_000, commit: "now", backfilled: false, digest: "d", score: 6.4, structure_score: 6.9, maintainability: 7.3, findings: 18, severities: { critical: 0, high: 1, medium: 7, low: 10 }, scored_files: 33, nloc: 3500, top_detectors: [["large_method", 5]], regressions: [{ path: "src/tangled.rs", from: 6.1, to: 4.9 }], improvements: [{ path: "src/ok.rs", from: 6, to: 8 }] },
  ],
  direction: "improving",
  changeSincePrevious: 0.9,
  change30Days: 0.3,
  backfilled: 2,
});

export function fakeHealthClient(overrides: Partial<HealthClient> = {}) {
  return {
    report: vi.fn(async () => report()),
    file: vi.fn(async () => detail()),
    prompt: vi.fn(async (_root: string, path: string, finding?: string) => `## Target\n${path} ${finding ?? "all"}`),
    trend: vi.fn(async () => trend()),
    buildHistory: vi.fn(async () => 1 as number | null),
    ...overrides,
  } as HealthClient & Record<"report" | "file" | "prompt" | "trend" | "buildHistory", ReturnType<typeof vi.fn>>;
}
