import { describe, expect, it } from "vitest";
import { aggregateLevel, type ColorBy } from "./aggregate";
import { badgesFor, filterLevelView, levelCanvas, placeLevel } from "./levelGraph";
import { groupKey } from "./identity";
import { badges, levelNode, levelView } from "./testing";
import type { FindingBadges, LevelView } from "./model";

const options = { cap: 40, coverage: 100, edgeCap: 100, importKind: "all" as const };
const canvasOptions = { viewKey: "level:workspace:", colorBy: "language" as ColorBy, frame: false, frameLabel: "ws" };
const none = new Set<never>();

function build(view: LevelView, overrides: Partial<typeof canvasOptions> = {}, found: FindingBadges | null = badges) {
  return levelCanvas(aggregateLevel(view, options), found, none, { ...canvasOptions, ...overrides });
}

describe("levelCanvas", () => {
  it("sizes nodes by file count, tones them by language, and thickens heavy edges", () => {
    const view = levelView({ nodes: [levelNode("big", "big", { file_count: 400 }), levelNode("small", "small", { file_count: 1, languages: { rust: 1 } })], edges: [{ from: "big", to: "small", runtime: 64, type_only: 0, in_cycle: false }] });
    const canvas = build(view);
    const big = canvas.nodes.find((n) => n.label === "big")!;
    const small = canvas.nodes.find((n) => n.label === "small")!;
    expect(big.width!).toBeGreaterThan(small.width!);
    expect(big.tone).not.toBe(small.tone);
    expect(canvas.edges[0].thickness!).toBeGreaterThan(3);
    expect(canvas.edges[0].label).toBe("");
    expect(canvas.edges[0].selectedLabel).toBe("64 imports");
  });

  it("draws leaves as bubbles sized by files and containers as regions, naming only the largest eight when far out", () => {
    const nodes = [levelNode("top", "top", { file_count: 50 }), levelNode("child", "child", { parent: "top", file_count: 9 }), ...Array.from({ length: 10 }, (_, i) => levelNode(`n${i}`, `n${i}`, { file_count: 10 + i }))];
    const canvas = build(levelView({ nodes, edges: [] }));
    const by = Object.fromEntries(canvas.nodes.map((n) => [n.label, n]));
    expect(by.top.bubble).toBe(false);
    expect(by.child.bubble).toBe(true);
    expect(by.n9.diameter!).toBeGreaterThan(by.n0.diameter!);
    expect(by.n9.height!).toBeGreaterThan(by.n9.diameter!);
    expect(canvas.nodes.filter((n) => n.major)).toHaveLength(8);
    expect(by.n9.major && !by.n0.major && !by.top.major).toBe(true);
    expect(by.n9.detail).toBe("typescript 100%");
  });

  it("gives each node its own colour in per-node mode and carries source and target colours on the edge", () => {
    const view = levelView({ nodes: [levelNode("a", "a"), levelNode("b", "b"), levelNode("s", "s", { synthetic: true })], edges: [{ from: "a", to: "b", runtime: 3, type_only: 0, in_cycle: false }] });
    const canvas = build(view, { colorBy: "node" });
    const by = Object.fromEntries(canvas.nodes.map((n) => [n.label, n]));
    expect(by.a.color).toMatch(/^var\(--color-category-\d+\)$/);
    expect(by.a.color).not.toBe(by.b.color);
    expect(by.s.color).toBe("var(--color-fg-muted)");
    expect(canvas.edges[0]).toMatchObject({ fromColor: by.a.color, toColor: by.b.color });
  });

  it("uses shared tone colours when colouring by an attribute", () => {
    const view = levelView({ nodes: [levelNode("a", "a"), levelNode("b", "b", { languages: { rust: 3 } })], edges: [] });
    const colors = build(view, { colorBy: "language" }).nodes.map((n) => n.color);
    expect(colors.every((c) => c!.startsWith("var(--color-"))).toBe(true);
    expect(new Set(colors).size).toBe(2);
  });

  it("marks cycle nodes and edges and dashes type-only edges", () => {
    const view = levelView({ nodes: [levelNode("a", "a", { in_cycle: true }), levelNode("b", "b")], edges: [{ from: "a", to: "b", runtime: 0, type_only: 2, in_cycle: true }] });
    const canvas = build(view);
    expect(canvas.nodes.find((n) => n.label === "a")!.inCycle).toBe(true);
    expect(canvas.edges[0]).toMatchObject({ inCycle: true, typeOnly: true });
  });

  it("puts every node inside a workspace frame when asked, and parents first after placement", () => {
    const view = levelView({ nodes: [levelNode("child", "child", { parent: "top" }), levelNode("top", "top")], edges: [] });
    const canvas = build(view, { frame: true });
    const frame = canvas.nodes.find((n) => n.type === "frame")!;
    expect(canvas.nodes.find((n) => n.label === "top")!.parentId).toBe(frame.id);
    expect(canvas.nodes.find((n) => n.label === "child")!.parentId).toBe(groupKey("top"));
    const placed = placeLevel(canvas, {}, false).nodes.map((n) => n.label);
    expect(placed.indexOf("ws")).toBeLessThan(placed.indexOf("top"));
    expect(placed.indexOf("top")).toBeLessThan(placed.indexOf("child"));
  });

  it("drops nesting and the frame when a layout could not nest", () => {
    const view = levelView({ nodes: [levelNode("child", "child", { parent: "top" }), levelNode("top", "top")], edges: [] });
    const flat = placeLevel(build(view, { frame: true }), {}, true);
    expect(flat.nodes.every((n) => n.parentId === null && n.type !== "frame")).toBe(true);
  });

  it("colours by finding severity when asked", () => {
    const view = levelView({ nodes: [levelNode("p:web", "web"), levelNode("p:core", "core")], edges: [] });
    const tones = Object.fromEntries(build(view, { colorBy: "severity" }).nodes.map((n) => [n.label, n.tone]));
    expect(tones).toEqual({ web: 11, core: -1 });
  });
});

describe("framework edges on the canvas", () => {
  it("are drawn as framework edges that do not move the layout and describe themselves when selected", () => {
    const view = { ...levelView({ nodes: [levelNode("a", "a"), levelNode("b", "b")], edges: [] }), framework_edges: [{ from: "a", to: "b", kinds: { route_registered_to: 2, component_renders: 1 } }] };
    const canvas = levelCanvas(aggregateLevel(view, { ...options, frameworks: true }), badges, none, canvasOptions);
    const edge = canvas.edges.find((e) => e.framework)!;
    expect(edge).toMatchObject({ id: "fw:a->b", weight: 3, label: "", selectedLabel: "2 route · 1 renders" });
    expect(canvas.links).toEqual([]);
    expect(canvas.edges.filter((e) => !e.framework)).toEqual([]);
  });
});

describe("badgesFor", () => {
  const found: FindingBadges = { finding_set: "s", by_group: { g: { high: 1, medium: 0, low: 0, info: 0 } }, by_file: { "pkg/src/a.ts": { high: 0, medium: 2, low: 0, info: 0 }, "pkg/src/b.ts": { high: 0, medium: 1, low: 1, info: 0 }, "pkg/other/c.ts": { high: 1, medium: 0, low: 0, info: 0 } } };

  it("reads group badges directly", () => {
    expect(badgesFor("g", found)).toEqual({ high: 1, medium: 0, low: 0, info: 0 });
    expect(badgesFor("missing", found)).toBeNull();
  });

  it("sums the files under a derived directory, and only those", () => {
    expect(badgesFor("dir:pkg/src", found)).toEqual({ high: 0, medium: 3, low: 1, info: 0 });
    expect(badgesFor("dir:pkg/sr", found)).toBeNull();
    expect(badgesFor("dir:pkg/src", null)).toBeNull();
  });

  it("sums the listed files of a loose-files node", () => {
    expect(badgesFor("rest:dir:pkg", found, ["pkg/src/a.ts", "pkg/other/c.ts", "pkg/none.ts"])).toEqual({ high: 1, medium: 2, low: 0, info: 0 });
    expect(badgesFor("rest:dir:pkg", found, ["pkg/none.ts"])).toBeNull();
  });
});

describe("filterLevelView", () => {
  const view = levelView({ nodes: [levelNode("p:web", "web"), levelNode("p:core", "core"), levelNode("p:util", "util")], edges: [{ from: "p:web", to: "p:core", runtime: 1, type_only: 0, in_cycle: false }, { from: "p:core", to: "p:util", runtime: 1, type_only: 0, in_cycle: false }] });

  it("changes nothing without filters", () => {
    expect(filterLevelView(view, badges, { search: " ", onlyWithFindings: false })).toEqual({ view, hidden: 0 });
  });

  it("filters by name and drops edges to removed nodes", () => {
    const result = filterLevelView(view, badges, { search: "WEB", onlyWithFindings: false });
    expect(result.view.nodes.map((n) => n.label)).toEqual(["web"]);
    expect(result.view.edges).toEqual([]);
    expect(result.hidden).toBe(2);
  });

  it("keeps only nodes with findings", () => {
    expect(filterLevelView(view, badges, { search: "", onlyWithFindings: true }).view.nodes.map((n) => n.label)).toEqual(["web"]);
  });
});
