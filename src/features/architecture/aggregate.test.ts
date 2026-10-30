import { describe, expect, it } from "vitest";
import { aggregateLevel, bandWidth, bubbleDiameter, dominantLanguage, FOLD_ID, languageLegend, languageMix, nodeSize, thinEdges, toneFor, type AggEdge } from "./aggregate";
import type { LevelEdge, LevelNode, LevelView } from "./model";

const node = (id: string, files = 3, overrides: Partial<LevelNode> = {}): LevelNode => ({
  id, label: id, kind: "declared_package", basis: "declared", explanation: "", file_count: files, languages: { rust: files },
  parent: null, in_cycle: false, synthetic: false, ...overrides,
});
const edge = (from: string, to: string, runtime = 1, type_only = 0, in_cycle = false): LevelEdge => ({ from, to, runtime, type_only, in_cycle });
const view = (nodes: LevelNode[], edges: LevelEdge[]): LevelView => ({
  snapshot: "s", level: "packages", focus: null, unit_kind: "declared_package", nodes, edges, framework_edges: [], total_nodes: nodes.length,
  nodes_truncated: false, edges_truncated: false, cycle_groups: 0,
});
const options = { cap: 40, coverage: 100, edgeCap: 100, importKind: "all" as const };

describe("aggregateLevel", () => {
  it("keeps everything when the level fits", () => {
    const result = aggregateLevel(view([node("b"), node("a")], [edge("a", "b", 2)]), options);
    expect(result.nodes.map((n) => n.id)).toEqual(["a", "b"]);
    expect(result.edges).toMatchObject([{ id: "a->b", weight: 2 }]);
    expect(result.foldedCount).toBe(0);
  });

  it("folds the least connected nodes into one node and aggregates their edges", () => {
    const nodes = ["hub", "a", "b", "c", "d"].map((id) => node(id));
    const edges = [edge("hub", "a", 5), edge("hub", "b", 4), edge("c", "hub", 2), edge("d", "hub", 1), edge("c", "d", 9)];
    const result = aggregateLevel(view(nodes, edges), { ...options, cap: 3 });
    const fold = result.nodes.find((n) => n.id === FOLD_ID)!;
    expect(result.nodes).toHaveLength(3);
    expect(fold.folded.length).toBe(result.foldedCount);
    expect(fold.label).toBe(`+${result.foldedCount} more`);
    expect(fold.file_count).toBe(3 * result.foldedCount);
    // No edge points at a node that was removed, and none loops on the fold node.
    const ids = new Set(result.nodes.map((n) => n.id));
    expect(result.edges.every((e) => ids.has(e.from) && ids.has(e.to) && e.from !== e.to)).toBe(true);
  });

  it("breaks ties by file count and then id so the choice is stable", () => {
    const nodes = [node("z", 1), node("y", 9), node("x", 9)];
    const first = aggregateLevel(view(nodes, []), { ...options, cap: 2 });
    const again = aggregateLevel(view([...nodes].reverse(), []), { ...options, cap: 2 });
    expect(first.nodes.map((n) => n.id)).toEqual(["x", FOLD_ID]);
    expect(again.nodes.map((n) => n.id)).toEqual(first.nodes.map((n) => n.id));
  });

  it("moves a node up to its nearest kept ancestor when its parent is folded", () => {
    const nodes = [node("top", 9), node("mid", 5, { parent: "top" }), node("leaf", 3, { parent: "mid" }), node("other", 1), node("extra", 1)];
    const edges = [edge("leaf", "other", 5), edge("top", "other", 4)];
    const result = aggregateLevel(view(nodes, edges), { ...options, cap: 4 });
    expect(result.nodes.find((n) => n.id === "leaf")?.parent).toBe("top");
  });

  it("counts only the chosen import kind", () => {
    const edges = [edge("a", "b", 3, 2)];
    const nodes = [node("a"), node("b")];
    expect(aggregateLevel(view(nodes, edges), { ...options, importKind: "runtime" }).edges[0].weight).toBe(3);
    expect(aggregateLevel(view(nodes, edges), { ...options, importKind: "type_only" }).edges[0].weight).toBe(2);
    expect(aggregateLevel(view(nodes, [edge("a", "b", 3, 0)]), { ...options, importKind: "type_only" }).edges).toEqual([]);
  });

  it("reports hidden edges", () => {
    const nodes = ["a", "b", "c"].map((id) => node(id));
    const result = aggregateLevel(view(nodes, [edge("a", "b", 90), edge("b", "c", 5), edge("a", "c", 5)]), { ...options, coverage: 80 });
    expect(result.edges.map((e) => e.id)).toEqual(["a->b"]);
    expect(result.hiddenEdges).toBe(2);
    expect(result.totalEdges).toBe(3);
  });
});

describe("framework edges", () => {
  const withFramework = (edges: LevelView["framework_edges"]): LevelView => ({ ...view([node("a"), node("b"), node("c")], [edge("a", "b")]), framework_edges: edges });

  it("are left out unless asked for, and kept apart from imports", () => {
    const edges = [{ from: "a", to: "b", kinds: { route_registered_to: 2, component_renders: 1 } }];
    expect(aggregateLevel(withFramework(edges), options).frameworkEdges).toEqual([]);
    const on = aggregateLevel(withFramework(edges), { ...options, frameworks: true });
    expect(on.frameworkEdges).toMatchObject([{ id: "fw:a->b", from: "a", to: "b", count: 3 }]);
    expect(on.edges.map((e) => e.id)).toEqual(["a->b"]);
  });

  it("follow folded nodes and drop relations inside the fold", () => {
    const nodes = ["hub", "a", "b", "c"].map((id) => node(id));
    const input: LevelView = { ...view(nodes, [edge("hub", "a", 5), edge("hub", "b", 4), edge("hub", "c", 3)]), framework_edges: [{ from: "a", to: "hub", kinds: { command_exposed_as: 1 } }, { from: "b", to: "c", kinds: { route_registered_to: 1 } }, { from: "c", to: "hub", kinds: { command_exposed_as: 2 } }] };
    const result = aggregateLevel(input, { ...options, cap: 3, frameworks: true });
    const ids = result.frameworkEdges.map((e) => e.id).sort();
    expect(ids).toContain("fw:fold:more->hub");
    expect(ids.some((id) => id === "fw:fold:more->fold:more")).toBe(false);
    expect(result.frameworkEdges.find((e) => e.id === "fw:fold:more->hub")!.count).toBeGreaterThanOrEqual(1);
  });
});

describe("thinEdges", () => {
  const e = (id: string, weight: number, inCycle = false): AggEdge => ({ id, from: id, to: `${id}x`, runtime: weight, typeOnly: 0, weight, inCycle });

  it("always keeps cycle edges, however light", () => {
    const kept = thinEdges([e("heavy", 100), e("light-cycle", 1, true)], 10, 10);
    expect(kept.map((x) => x.id)).toEqual(["heavy", "light-cycle"]);
  });

  it("never exceeds the cap", () => {
    expect(thinEdges([e("a", 1), e("b", 1), e("c", 1)], 100, 2)).toHaveLength(2);
  });

  it("shows nothing but cycle edges at zero coverage", () => {
    expect(thinEdges([e("a", 5), e("b", 5, true)], 0, 10).map((x) => x.id)).toEqual(["b"]);
  });
});

describe("encodings", () => {
  it("grows boxes with file count on a clamped square-root scale", () => {
    expect(nodeSize(0).width).toBe(168);
    expect(nodeSize(400).width).toBe(320);
    expect(nodeSize(100_000)).toEqual(nodeSize(400));
    expect(nodeSize(25).width).toBeGreaterThan(nodeSize(4).width);
  });

  it("widens bands on a log scale between 2 and 16 pixels", () => {
    expect(bandWidth(1)).toBe(2);
    expect(bandWidth(1_000_000)).toBe(16);
    expect(bandWidth(8)).toBeGreaterThan(bandWidth(2));
  });

  it("sizes bubbles by file count relative to the largest on the level", () => {
    expect(bubbleDiameter(0, 100)).toBe(44);
    expect(bubbleDiameter(100, 100)).toBe(150);
    expect(bubbleDiameter(500, 100)).toBe(150);
    expect(bubbleDiameter(25, 100)).toBe(97);
    expect(bubbleDiameter(5, 0)).toBe(44);
    // The same counts look the same whatever the repository's scale.
    expect(bubbleDiameter(2, 4)).toBe(bubbleDiameter(2000, 4000));
  });

  it("describes the language mix of a node, largest first and at most three", () => {
    expect(languageMix({ rust: 1, typescript: 3 })).toBe("typescript 75% · rust 25%");
    expect(languageMix({ a: 4, b: 3, c: 2, d: 1 })).toBe("a 40% · b 30% · c 20%");
    expect(languageMix({})).toBe("");
  });

  it("picks the dominant language with ties going to the alphabetically first", () => {
    expect(dominantLanguage({ typescript: 3, rust: 3 })).toBe("rust");
    expect(dominantLanguage({})).toBeNull();
  });

  it("assigns language tones by file count and keeps them for the colour choice", () => {
    const nodes = [node("a", 5, { languages: { rust: 5 } }), node("b", 9, { languages: { typescript: 9 } })];
    const legend = languageLegend(nodes);
    expect(legend.map((l) => [l.label, l.tone])).toEqual([["typescript", 0], ["rust", 1]]);
    expect(toneFor(nodes[0], "language", legend)).toBe(1);
    expect(toneFor(nodes[0], "kind", legend)).toBe(0);
    expect(toneFor(node("s", 1, { synthetic: true, languages: {} }), "language", legend)).toBe(-1);
  });
});
