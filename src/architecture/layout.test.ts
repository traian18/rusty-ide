import { describe, expect, it } from "vitest";
import { layoutGraph } from "./layout";

const nodes = (...keys: string[]) => keys.map((key) => ({ key }));
const edge = (from: string, to: string) => ({ from, to });

describe("layoutGraph", () => {
  it("is deterministic and independent of input order", () => {
    const edges = [edge("a", "b"), edge("a", "c"), edge("b", "d"), edge("c", "d"), edge("d", "e")];
    const first = layoutGraph(nodes("a", "b", "c", "d", "e"), edges);
    const second = layoutGraph(nodes("e", "d", "c", "b", "a"), [...edges].reverse());
    expect(second).toEqual(first);
    expect(layoutGraph(nodes("a", "b", "c", "d", "e"), edges)).toEqual(first);
  });

  it("places dependencies to the right of what depends on them", () => {
    const positions = layoutGraph(nodes("a", "b", "c"), [edge("a", "b"), edge("b", "c")]);
    expect(positions.a.x).toBeLessThan(positions.b.x);
    expect(positions.b.x).toBeLessThan(positions.c.x);
  });

  it("layers by longest path", () => {
    const positions = layoutGraph(nodes("a", "b", "c"), [edge("a", "b"), edge("b", "c"), edge("a", "c")]);
    expect(positions.c.x).toBeGreaterThan(positions.b.x);
  });

  it("handles cycles and self loops without looping or dropping nodes", () => {
    const positions = layoutGraph(nodes("a", "b", "c"), [edge("a", "b"), edge("b", "a"), edge("c", "c"), edge("b", "c")]);
    expect(Object.keys(positions).sort()).toEqual(["a", "b", "c"]);
    expect(new Set(Object.values(positions).map((p) => `${p.x},${p.y}`)).size).toBe(3);
  });

  it("ignores edges to unknown nodes and duplicate edges", () => {
    const positions = layoutGraph(nodes("a", "b"), [edge("a", "b"), edge("a", "b"), edge("a", "ghost"), edge("ghost", "b")]);
    expect(Object.keys(positions).sort()).toEqual(["a", "b"]);
    expect(positions.a.x).toBeLessThan(positions.b.x);
  });

  it("packs unconnected nodes into a grid below the layered part", () => {
    const positions = layoutGraph(nodes("a", "b", "x", "y", "z"), [edge("a", "b")], {}, { isolatedColumns: 2 });
    const layeredBottom = Math.max(positions.a.y, positions.b.y);
    for (const key of ["x", "y", "z"]) expect(positions[key].y).toBeGreaterThan(layeredBottom);
    expect(positions.x.y).toBe(positions.y.y);
    expect(positions.z.y).toBeGreaterThan(positions.x.y);
  });

  it("lets pinned positions win and ignores pins for unknown nodes", () => {
    const positions = layoutGraph(nodes("a", "b"), [edge("a", "b")], { a: { x: 7, y: 9 }, ghost: { x: 1, y: 1 } });
    expect(positions.a).toEqual({ x: 7, y: 9 });
    expect(positions).not.toHaveProperty("ghost");
    expect(positions.b).toEqual(layoutGraph(nodes("a", "b"), [edge("a", "b")]).b);
  });

  it("keeps an unchanged graph in place when only a new node appears", () => {
    const before = layoutGraph(nodes("a", "b"), [edge("a", "b")]);
    const after = layoutGraph(nodes("a", "b", "z"), [edge("a", "b")]);
    expect(after.a).toEqual(before.a);
    expect(after.b).toEqual(before.b);
  });

  it("copes with a very deep chain and a wide fan", () => {
    const depth = 5000;
    const keys = Array.from({ length: depth }, (_, i) => `n${String(i).padStart(5, "0")}`);
    const chain = keys.slice(1).map((key, i) => edge(keys[i], key));
    const positions = layoutGraph(nodes(...keys), chain);
    expect(positions[keys[depth - 1]].x).toBeGreaterThan(positions[keys[0]].x);
    const fan = layoutGraph(nodes("root", ...keys.slice(0, 300)), keys.slice(0, 300).map((key) => edge("root", key)));
    expect(new Set(Object.values(fan).map((p) => p.y)).size).toBeGreaterThan(100);
  });

  it("orders a layer to keep connected nodes level, reducing crossings", () => {
    // a->x and b->y: without ordering by neighbours y could sort before x.
    const positions = layoutGraph(nodes("a", "b", "y", "x"), [edge("a", "x"), edge("b", "y")]);
    expect(Math.sign(positions.a.y - positions.b.y)).toBe(Math.sign(positions.x.y - positions.y.y));
  });
});
