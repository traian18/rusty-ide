import { describe, expect, it } from "vitest";
import { groupDrillGraph, NO_FILTER, totalFindings, worstSeverity } from "./graphModel";
import type { FindingBadges, GroupGraph, GroupSummary } from "./model";
import { fileKey } from "./identity";

const summary = (id: string, label: string, overrides: Partial<GroupSummary> = {}): GroupSummary => ({
  id, kind: "declared_package", label, basis: "declared", explanation: "", member_count: 3, involves_type_only: false, ...overrides,
});
const counts = (high = 0, medium = 0, low = 0, info = 0) => ({ high, medium, low, info });
const badges: FindingBadges = { finding_set: "f", by_file: { "src/a.ts": counts(0, 1) }, by_group: { "p:web": counts(1, 0, 2), "p:core": counts(0, 0, 0, 1) } };

describe("groupDrillGraph", () => {
  const drill: GroupGraph = {
    snapshot: "s", group: summary("p:web", "web"), total_members: 3, truncation: "none", boundary: { outgoing: 1, incoming: 0 }, framework_edges: [],
    nodes: [{ file: "src/a.ts", package: "p" }, { file: "src/b.ts", package: "p" }, { file: "lib/c.ts", package: "p" }],
    edges: [
      { from: "src/a.ts", to: "src/b.ts", fact: "1", kind: "runtime" },
      { from: "src/a.ts", to: "src/b.ts", fact: "2", kind: "type_only" },
      { from: "src/b.ts", to: "lib/c.ts", fact: "3", kind: "type_only" },
    ],
  };

  it("merges repeated imports between two files into one weighted edge", () => {
    const graph = groupDrillGraph(drill, badges, new Set(), {});
    expect(graph.viewKey).toBe("group:p:web");
    expect(graph.edges.map((e) => [e.weight, e.typeOnly])).toEqual([[2, false], [1, true]]);
    expect(graph.nodes.find((n) => n.id === fileKey("src/a.ts"))).toMatchObject({ label: "a.ts", subtitle: "src/a.ts", worst: "medium" });
  });

  it("filters files and import kinds", () => {
    expect(groupDrillGraph(drill, badges, new Set(), {}, { ...NO_FILTER, search: "src/" }).nodes).toHaveLength(2);
    const typeOnly = groupDrillGraph(drill, badges, new Set(), {}, { ...NO_FILTER, importKind: "type_only" });
    expect(typeOnly.edges.map((e) => e.weight)).toEqual([1, 1]);
    expect(groupDrillGraph(drill, badges, new Set(), {}, { ...NO_FILTER, onlyWithFindings: true }).nodes.map((n) => n.label)).toEqual(["a.ts"]);
  });
});

describe("severity helpers", () => {
  it("finds the worst severity and totals", () => {
    expect(worstSeverity(counts(0, 0, 3, 1))).toBe("low");
    expect(worstSeverity(counts())).toBeNull();
    expect(worstSeverity(null)).toBeNull();
    expect(totalFindings(counts(1, 2, 3, 4))).toBe(10);
    expect(totalFindings(undefined)).toBe(0);
  });
});

describe("groupDrillGraph framework edges", () => {
  const graph: GroupGraph = { snapshot: "s", group: summary("p:web", "web"), total_members: 2, truncation: "none", boundary: { outgoing: 0, incoming: 0 }, nodes: [{ file: "src/a.ts", package: "p" }, { file: "src/b.ts", package: "p" }], edges: [], framework_edges: [{ from: "src/a.ts", to: "src/b.ts", kind: "route_registered_to" as const, framework: "express", label: "GET /x" }, { from: "src/a.ts", to: "src/missing.ts", kind: "component_renders" as const, framework: "react", label: "<X />" }] };

  it("adds relations between shown files only when asked", () => {
    expect(groupDrillGraph(graph, null, new Set(), {}, NO_FILTER).edges.some((e) => e.framework)).toBe(false);
    const on = groupDrillGraph(graph, null, new Set(), {}, NO_FILTER, true);
    expect(on.edges.filter((e) => e.framework)).toMatchObject([{ id: "fw:src/a.ts->src/b.ts", label: "GET /x" }]);
  });
});
