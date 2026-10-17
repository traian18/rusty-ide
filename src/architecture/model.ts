/**
 * Types mirroring what the Tauri repository commands return. They follow the rusty-core models
 * as serialized (snake_case), so the UI reads exactly what the agent tools read. Pure types: no
 * React, store, or Tauri imports (see layering.test.ts).
 */

export type GroupKind = "declared_package" | "source_root" | "directory" | "import_cycle";
export type GroupBasis = "declared" | "inferred" | "derived";
export type ImportKind = "runtime" | "type_only";
export type Truncation = "none" | "depth_limit" | "node_limit" | "edge_limit";
export type Severity = "high" | "medium" | "low" | "info";
export type Confidence = "high" | "medium" | "low";
export type FindingKind = "measurable" | "candidate";

export interface RepositoryError {
  code: string;
  message: string;
}

export interface GroupSummary {
  id: string;
  kind: GroupKind;
  label: string;
  basis: GroupBasis;
  explanation: string;
  member_count: number;
  involves_type_only: boolean;
}

export interface OverviewEdge {
  from: string;
  to: string;
  runtime: number;
  type_only: number;
}

export interface GroupOverview {
  snapshot: string;
  kind: GroupKind;
  nodes: GroupSummary[];
  edges: OverviewEdge[];
  truncation: Truncation;
}

export interface Diagnostic {
  path: string | null;
  message: string;
}

export type RelationKind = "route_registered_to" | "provider_injected_into" | "component_renders" | "command_exposed_as" | "model_mapped_to_table";
export type Certainty = "declared" | "convention";

export interface FrameworkApplication {
  framework: string;
  package: string;
  /** The manifest fact that showed the framework applies. */
  evidence: string;
}

export interface FrameworksSummary {
  configured: boolean;
  applications: FrameworkApplication[];
  relations: number;
  partial: boolean;
  diagnostics_total: number;
  diagnostics: Diagnostic[];
}

export interface FrameworkRelation {
  id: string;
  kind: RelationKind;
  framework: string;
  rule: { id: string; version: number };
  certainty: Certainty;
  from: string;
  to: string | null;
  from_symbol: string | null;
  to_symbol: string | null;
  label: string;
  evidence: { file: string; span: { start: number; end: number }; text: string };
  package: string | null;
}

export interface FrameworkPage {
  snapshot: string;
  relations: FrameworkRelation[];
  next_cursor: unknown | null;
  partial: boolean;
}

export const RELATION_LABEL: Record<RelationKind, string> = {
  route_registered_to: "route",
  provider_injected_into: "provider",
  component_renders: "renders",
  command_exposed_as: "command",
  model_mapped_to_table: "model",
};

export interface SnapshotSummary {
  id: string;
  packages: number;
  files: number;
  imports: number;
  partial: boolean;
  languages: string[];
  groups_configured: boolean;
  group_count: number;
  unattached_files: number;
  diagnostics_total: number;
  diagnostics: Diagnostic[];
  frameworks: FrameworksSummary;
}

export interface GitSummary {
  id: string;
  head: string;
  commits_used: number;
  shallow: boolean;
  working_tree_dirty: boolean;
  walk_stop: string;
  interpretation: string;
}

export interface FindingsSummary {
  total: number;
  suppressed: number;
  by_rule: Record<string, number>;
  by_kind: Partial<Record<FindingKind, number>>;
  by_severity: Partial<Record<Severity, number>>;
  skipped_rules: { rule: { id: string; version: number }; reason: string }[];
  truncated_rules: string[];
}

export interface FindingsStatus {
  id: string;
  summary: FindingsSummary;
}

export interface StageError {
  stage: string;
  code: string;
  message: string;
}

export interface OpenResponse {
  root: string;
  discovery: { cargo: boolean; package_json: boolean; symlink_safe: boolean };
  snapshot: SnapshotSummary | null;
  git: GitSummary | null;
  findings: FindingsStatus | null;
  built_at_ms: number | null;
}

export interface RefreshResponse {
  snapshot: SnapshotSummary;
  git: GitSummary | null;
  findings: FindingsStatus | null;
  built_at_ms: number;
  stage_errors: StageError[];
}

export interface GroupGraphNode {
  file: string;
  package: string | null;
}

export interface GroupGraphEdge {
  from: string;
  to: string;
  fact: string;
  kind: ImportKind;
}

export interface GroupGraph {
  snapshot: string;
  group: GroupSummary;
  nodes: GroupGraphNode[];
  edges: GroupGraphEdge[];
  framework_edges: { from: string; to: string; kind: RelationKind; framework: string; label: string }[];
  boundary: { outgoing: number; incoming: number };
  truncation: Truncation;
  total_members: number;
}

export interface SourceLocation {
  file: string;
  start: number;
  end: number;
  /** 1-based; absent when the file changed since the snapshot. */
  line: number | null;
  column: number | null;
  stale: boolean;
}

export interface ImportEdge {
  fact: {
    id: string;
    importing_file: string;
    spelling: string;
    form: string;
    span: { start: number; end: number };
    kind: ImportKind;
  };
  from_package: string | null;
  to_package: string | null;
  resolution: Record<string, unknown>;
  rule: string;
  evidence: string[];
}

export interface ImportPage {
  snapshot: string;
  edges: ImportEdge[];
  next_cursor: unknown | null;
  partial_coverage: boolean;
}

export interface GroupAssignment {
  group: GroupSummary;
  evidence: string[];
  cycle_sites: string[];
  evidence_truncated: boolean;
}

export interface Finding {
  id: string;
  rule: { id: string; version: number };
  kind: FindingKind;
  severity: Severity;
  confidence: Confidence;
  title: string;
  summary: string;
  rationale: string;
  subjects: string[];
  packages: string[];
  impact: number;
  locations: SourceLocation[];
  interpretation: string | null;
}

export interface FindingEntry {
  finding: Finding;
  suppressed_reason: string | null;
}

export interface FindingsPage {
  set: string;
  entries: FindingEntry[];
  next_cursor: unknown | null;
}

export interface FindingExplanation {
  entry: FindingEntry;
  rule_description: string | null;
  import_sites: ImportEdge[];
  repository_snapshot_available: boolean;
}

export interface SeverityCounts {
  high: number;
  medium: number;
  low: number;
  info: number;
}

export interface FindingBadges {
  finding_set: string | null;
  by_file: Record<string, SeverityCounts>;
  by_group: Record<string, SeverityCounts>;
}

export interface GitFileFacts {
  git_snapshot: string;
  churn: {
    file: string;
    commits: number;
    lines_added: number;
    lines_removed: number;
    contributors: number;
    first_change: number;
    last_change: number;
    absent_at_head: boolean;
  } | null;
  co_changed: {
    partner: string;
    support: number;
    file_commits: number;
    confidence_per_mille: number;
  }[];
  contributors: {
    contributor: { id: string; name: string };
    commits: number;
    commit_share_per_mille: number;
  }[];
  interpretation: string;
}

export interface Freshness {
  built_at_ms: number | null;
  checked: number;
  changed: string[];
  missing: string[];
}

export interface NodesExist {
  groups: string[];
  files: string[];
}

export type LevelName = "packages" | "components";

/** A candidate node of one level of the architecture view, as the host derived it. */
export interface LevelNode {
  /** A group id, `dir:<path>` for a directory derived from file paths, `other`, or `rest:…`. */
  id: string;
  label: string;
  kind: GroupKind;
  /** Null for synthetic nodes. */
  basis: GroupBasis | null;
  explanation: string;
  file_count: number;
  languages: Record<string, number>;
  parent: string | null;
  /** The node's direct components, biggest first, drawn as small circles inside it. */
  children: LevelChild[];
  /** Components beyond the ones in `children`. */
  more_children: number;
  /** Paths of a loose-files node's files, so its findings can be summed; empty otherwise. */
  files: string[];
  in_cycle: boolean;
  synthetic: boolean;
}

/** One small circle inside a node; opening it shows its own components, or its files when it has none. */
export interface LevelChild {
  /** A `dir:<path>` id that the components level accepts as a focus. */
  id: string;
  label: string;
  file_count: number;
  has_children: boolean;
}

export interface LevelEdge {
  from: string;
  to: string;
  runtime: number;
  type_only: number;
  in_cycle: boolean;
}

export interface LevelFrameworkEdge {
  from: string;
  to: string;
  /** Relation counts by kind. */
  kinds: Partial<Record<RelationKind, number>>;
}

export interface LevelView {
  snapshot: string;
  level: LevelName;
  focus: string | null;
  unit_kind: GroupKind;
  /** True when the focus has no folders, so its files are the thing to show. */
  leaf: boolean;
  nodes: LevelNode[];
  edges: LevelEdge[];
  framework_edges: LevelFrameworkEdge[];
  total_nodes: number;
  nodes_truncated: boolean;
  edges_truncated: boolean;
  cycle_groups: number;
}
