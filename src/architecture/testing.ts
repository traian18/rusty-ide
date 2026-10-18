/** Test fixtures: a fake [`ArchitectureClient`] with realistic default answers. */
import { vi } from "vitest";
import type { ArchitectureClient } from "./client";
import type {
  FindingBadges, FindingEntry, FindingsPage, GroupGraph, GroupSummary, OpenResponse,
  RefreshResponse, SnapshotSummary, LevelNode, LevelView,
} from "./model";

export const ROOT = "/ws";


export const group = (id: string, label: string, overrides: Partial<GroupSummary> = {}): GroupSummary => ({
  id, kind: "declared_package", label, basis: "declared", explanation: `${label} is declared by a manifest.`, member_count: 3, involves_type_only: false, ...overrides,
});

export const snapshot = (overrides: Partial<SnapshotSummary> = {}): SnapshotSummary => ({
  id: "snap-1", packages: 2, files: 6, imports: 5, partial: false, languages: ["rust"], groups_configured: true, group_count: 2,
  unattached_files: 0, diagnostics_total: 0, diagnostics: [],
  frameworks: { configured: true, applications: [], relations: 0, partial: false, diagnostics_total: 0, diagnostics: [] }, ...overrides,
});

export const openResponse = (overrides: Partial<OpenResponse> = {}): OpenResponse => ({
  root: ROOT,
  discovery: { cargo: true, package_json: true, symlink_safe: true },
  snapshot: snapshot(),
  git: { id: "git-1", head: "abc", commits_used: 4, shallow: false, working_tree_dirty: false, walk_stop: "exhausted", interpretation: "Historical correlation only." },
  findings: { id: "set-1", summary: { total: 2, suppressed: 0, by_rule: {}, by_kind: {}, by_severity: {}, skipped_rules: [], truncated_rules: [] } },
  built_at_ms: Date.now() - 120_000,
  ...overrides,
});

export const drillGraph = (overrides: Partial<GroupGraph> = {}): GroupGraph => ({
  snapshot: "snap-1", group: group("p:web", "web"), total_members: 2, truncation: "none", boundary: { outgoing: 2, incoming: 1 },
  nodes: [{ file: "src/a.ts", package: "p:web" }, { file: "src/b.ts", package: "p:web" }],
  edges: [{ from: "src/a.ts", to: "src/b.ts", fact: "f1", kind: "runtime" }], framework_edges: [],
  ...overrides,
});

export const levelNode = (id: string, label: string, overrides: Partial<LevelNode> = {}): LevelNode => ({
  id, label, kind: "declared_package", basis: "declared", explanation: `${label} is declared by a manifest.`, file_count: 3,
  languages: { typescript: 3 }, parent: null, children: [], more_children: 0, files: [], in_cycle: false, synthetic: false, ...overrides,
});

export const levelView = (overrides: Partial<LevelView> = {}): LevelView => ({
  snapshot: "snap-1", level: "packages", focus: null, unit_kind: "declared_package", leaf: false,
  nodes: [levelNode("p:web", "web"), levelNode("p:core", "core", { languages: { rust: 3 } })],
  edges: [{ from: "p:web", to: "p:core", runtime: 2, type_only: 1, in_cycle: false }],
  framework_edges: [], total_nodes: 2, nodes_truncated: false, edges_truncated: false, cycle_groups: 0, ...overrides,
});

export const badges: FindingBadges = {
  finding_set: "set-1",
  by_file: { "src/a.ts": { high: 0, medium: 1, low: 0, info: 0 } },
  by_group: { "p:web": { high: 0, medium: 1, low: 0, info: 0 } },
};

export const findingEntry = (overrides: Partial<FindingEntry["finding"]> = {}): FindingEntry => ({
  suppressed_reason: null,
  finding: {
    id: "import-cycle:src/a.ts", rule: { id: "import-cycle", version: 1 }, kind: "measurable", severity: "medium", confidence: "high",
    title: "Import cycle between 2 files", summary: "2 files import each other.", rationale: "Cycles couple files.",
    subjects: ["src/a.ts", "src/b.ts"], packages: ["p:web"], impact: 2, interpretation: null,
    locations: [{ file: "src/a.ts", start: 4, end: 20, line: 3, column: 5, stale: false }],
    ...overrides,
  },
});

export const findingsPage = (entries: FindingEntry[] = [findingEntry()]): FindingsPage => ({ set: "set-1", entries, next_cursor: null });

export type FakeClient = { [K in keyof ArchitectureClient]: ReturnType<typeof vi.fn> } & ArchitectureClient;

/** A client answering every call with sensible data; override any method per test. */
export function fakeClient(overrides: Partial<ArchitectureClient> = {}): FakeClient {
  const base: ArchitectureClient = {
    open: vi.fn(async () => openResponse()),
    refresh: vi.fn(async (): Promise<RefreshResponse> => ({ snapshot: snapshot(), git: openResponse().git, findings: openResponse().findings, built_at_ms: Date.now(), stage_errors: [] })),
    cancel: vi.fn(async () => undefined),
    close: vi.fn(async () => undefined),
    architecture: vi.fn(async (_root, request) => levelView({ level: request.level, focus: request.focus ?? null, leaf: request.focus != null })),
    frameworkRelations: vi.fn(async () => ({ snapshot: "snap-1", relations: [], next_cursor: null, partial: false })),
    groupGraph: vi.fn(async (_root, request) => (request.group === "p:web" ? drillGraph() : drillGraph({ group: group(request.group, request.group) }))),
    edges: vi.fn(async () => ({ snapshot: "snap-1", edges: [], next_cursor: null, partial_coverage: false })),
    groupsOf: vi.fn(async () => []),
    findings: vi.fn(async () => findingsPage()),
    findingExplain: vi.fn(async () => ({ entry: findingEntry(), rule_description: "Mutually reachable files.", import_sites: [], repository_snapshot_available: true })),
    findingBadges: vi.fn(async () => badges),
    gitFile: vi.fn(async () => null),
    freshness: vi.fn(async () => ({ built_at_ms: Date.now(), checked: 6, changed: [], missing: [] })),
    nodesExist: vi.fn(async (_root, request) => ({ groups: request.groups, files: request.files })),
    loadState: vi.fn(async () => null),
    saveState: vi.fn(async () => undefined),
    onWorkspaceChanged: vi.fn(async () => () => undefined),
    onAnalysisUpdated: vi.fn(async () => () => undefined),
  };
  return { ...base, ...overrides } as FakeClient;
}
