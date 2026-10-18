/** Code health as the host returns it: core types keep snake_case, host rows are camelCase. */
export type Band = "excellent" | "good" | "fair" | "needs_work" | "at_risk";
export type Severity = "low" | "medium" | "high" | "critical";
export type Category = "structural_complexity" | "size_and_complexity" | "duplication" | "test_coverage" | "organizational" | "error_handling" | "test_quality";

export interface SeverityCounts {
  critical: number;
  high: number;
  medium: number;
  low: number;
}

export interface WorstFile {
  path: string;
  score: number;
}

export interface RepositoryHealth {
  average: number | null;
  band: Band | null;
  hotspot_health: number | null;
  maintainability_average: number | null;
  maintainability_hotspot: number | null;
  production_average: number | null;
  structure_average: number | null;
  history_average: number | null;
  structure_hotspot: number | null;
  history_hotspot: number | null;
  worst_file: WorstFile | null;
  worst_test: WorstFile | null;
  file_count: number;
  production_file_count: number;
  hotspot_count: number;
  unanalysed_count: number;
  analysed_per_mille: number;
  distribution: { band: Band; files: number; nloc: number; nloc_per_mille: number }[];
}

export interface SelfCheck {
  examined: number;
  fixed_among_worst: number;
  files: number;
  fixed_files: number;
  precision_per_mille: number;
  base_rate_per_mille: number;
  lift: number;
  recall_per_mille: number;
  window_days: number;
  worst: [string, boolean][];
  note: string;
}

export interface HealthFileRow {
  path: string;
  language: string;
  nloc: number;
  test: boolean;
  hotspot: boolean;
  defect: number | null;
  maintainability: number | null;
  band: Band | null;
  structure: number;
  history: number;
  findings: SeverityCounts;
  topIssue: string | null;
}

export interface FolderHealth {
  path: string;
  files: number;
  nloc: number;
  average: number | null;
  band: Band | null;
  worst_decile: number | null;
  worst_file: WorstFile | null;
  hotspots: number;
  unanalysed: number;
}

export interface DetectorSummary {
  id: string;
  category: Category;
  summary: string;
  files: number;
  findings: SeverityCounts;
  examples: string[];
}

export interface HealthReport {
  snapshot: string;
  repository: RepositoryHealth;
  selfCheck: SelfCheck | null;
  files: HealthFileRow[];
  folders: FolderHealth[];
  detectors: DetectorSummary[];
  findings: number;
  history: boolean;
  languagesMeasured: string[];
}

export interface ScoredFinding {
  id: string;
  detector: string;
  detector_version: number;
  category: Category;
  severity: Severity;
  path: string;
  function: string | null;
  class: string | null;
  start_line: number;
  end_line: number;
  measured: Record<string, number>;
  reason: string;
  impact: number;
}

export interface CategoryDeduction {
  raw: number;
  cap: number;
  applied: number;
}

export interface FunctionRow {
  name: string;
  startLine: number;
  endLine: number;
  nloc: number;
  ccn: number;
  cognitive: number;
  maxNesting: number;
  params: number;
}

export interface HealthFileDetail {
  row: HealthFileRow;
  findings: ScoredFinding[];
  defectCategories: Partial<Record<Category, CategoryDeduction>>;
  maintainabilityCategories: Partial<Record<Category, CategoryDeduction>>;
  unclamped: number | null;
  functions: FunctionRow[];
  importers: number;
  signals: {
    commits: number;
    commits_recent: number;
    fix_commits: number;
    hotspot: boolean;
    contributors: number;
    owner: { name: string } | null;
    owner_share_per_mille: number;
  } | null;
  target: number;
}

export const BAND_LABEL: Record<Band, string> = { excellent: "Excellent", good: "Good", fair: "Fair", needs_work: "Needs work", at_risk: "At risk" };
export const BAND_ORDER: Band[] = ["at_risk", "needs_work", "fair", "good", "excellent"];
export const CATEGORY_LABEL: Record<Category, string> = {
  structural_complexity: "Structure",
  size_and_complexity: "Size and complexity",
  duplication: "Duplication",
  test_coverage: "Test coverage",
  organizational: "Change history",
  error_handling: "Error handling",
  test_quality: "Test quality",
};

/** Same cut-offs as the core: absolute, so a score means the same in every repository. */
export function bandOf(score: number): Band {
  if (score >= 8.5) return "excellent";
  if (score >= 7) return "good";
  if (score >= 5.5) return "fair";
  if (score >= 4) return "needs_work";
  return "at_risk";
}

export const detectorLabel = (id: string) => id.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
export const totalFindings = (c: SeverityCounts) => c.critical + c.high + c.medium + c.low;
