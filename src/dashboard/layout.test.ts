import { describe, expect, it } from "vitest";

import { nestedTreemap } from "./nestedTreemap";
import { enclose, packSiblings, packTree, type Circle } from "./pack";
import { pathTree } from "./pathTree";

const files = (entries: [string, number][]) => pathTree(entries, ([path]) => path, ([, weight]) => weight);

describe("pathTree", () => {
  it("builds folders with summed weights and merges single-folder chains", () => {
    const tree = files([
      ["crates/core/src/a.rs", 30],
      ["crates/core/src/b.rs", 10],
      ["web/app.ts", 5],
      ["README.md", 1],
    ]);
    expect(tree.weight).toBe(46);
    expect(tree.files).toBe(4);
    const names = tree.children.map((c) => c.name).sort();
    expect(names).toEqual(["README.md", "crates/core/src", "web"]);
    const merged = tree.children.find((c) => c.name === "crates/core/src")!;
    expect(merged.path).toBe("crates/core/src");
    expect(merged.weight).toBe(40);
    expect(merged.children.map((c) => c.item)).toEqual([
      ["crates/core/src/a.rs", 30],
      ["crates/core/src/b.rs", 10],
    ]);
  });
});

describe("nestedTreemap", () => {
  it("places every file inside its folder frame, with no overlap", () => {
    const tree = files([
      ["src/a.rs", 400],
      ["src/b.rs", 200],
      ["src/deep/c.rs", 100],
      ["web/app.ts", 300],
    ]);
    const { frames, cells } = nestedTreemap(tree, { x: 0, y: 0, w: 800, h: 600 });
    expect(cells).toHaveLength(4);
    expect(frames.map((f) => f.node.path).sort()).toEqual(["src", "src/deep", "web"]);
    for (const cell of cells) {
      const folder = cell.node.path.slice(0, cell.node.path.lastIndexOf("/"));
      const frame = frames.find((f) => f.node.path === folder)!;
      expect(cell.x).toBeGreaterThanOrEqual(frame.x);
      expect(cell.y).toBeGreaterThanOrEqual(frame.y);
      expect(cell.x + cell.w).toBeLessThanOrEqual(frame.x + frame.w + 1e-6);
      expect(cell.y + cell.h).toBeLessThanOrEqual(frame.y + frame.h + 1e-6);
    }
    expect(frames.find((f) => f.node.path === "src")!.labelled).toBe(true);
    // The biggest file gets the most room.
    const area = (path: string) => cells.filter((c) => c.node.path === path).map((c) => c.w * c.h)[0];
    expect(area("src/a.rs")).toBeGreaterThan(area("src/b.rs"));
  });
});

const overlap = (a: Circle, b: Circle) => Math.hypot(a.x - b.x, a.y - b.y) < a.r + b.r - 1e-6;

describe("packSiblings", () => {
  it("packs circles of mixed sizes without overlap, tightly", () => {
    const circles: Circle[] = Array.from({ length: 60 }, (_, i) => ({ x: 0, y: 0, r: 1 + ((i * 7) % 11) }));
    packSiblings(circles);
    for (let i = 0; i < circles.length; i += 1) for (let j = i + 1; j < circles.length; j += 1) expect(overlap(circles[i], circles[j])).toBe(false);
    const around = enclose(circles);
    for (const c of circles) expect(Math.hypot(c.x - around.x, c.y - around.y) + c.r).toBeLessThanOrEqual(around.r + 1e-6);
    // Packed area over enclosing area: a loose pack would be far below a half.
    const filled = circles.reduce((sum, c) => sum + c.r * c.r, 0) / (around.r * around.r);
    expect(filled).toBeGreaterThan(0.5);
  });

  it("handles one and two circles", () => {
    const one = [{ x: 5, y: 5, r: 2 }];
    packSiblings(one);
    expect(one[0]).toEqual({ x: 0, y: 0, r: 2 });
    const two = [
      { x: 0, y: 0, r: 2 },
      { x: 0, y: 0, r: 3 },
    ];
    packSiblings(two);
    expect(Math.hypot(two[0].x - two[1].x, two[0].y - two[1].y)).toBeCloseTo(5);
  });
});

describe("packTree", () => {
  it("nests files in their folders inside the requested radius", () => {
    const tree = files([
      ["src/a.rs", 400],
      ["src/b.rs", 100],
      ["src/deep/c.rs", 50],
      ["src/deep/d.rs", 50],
      ["web/app.ts", 300],
      ["web/view.ts", 10],
    ]);
    const packed = packTree(tree, 100);
    expect(packed[0].node).toBe(tree);
    expect(packed[0].r).toBeCloseTo(100);
    const byPath = new Map(packed.map((p) => [p.node.path, p]));
    for (const p of packed.slice(1)) {
      const parentPath = p.node.path.includes("/") ? p.node.path.slice(0, p.node.path.lastIndexOf("/")) : "";
      const parent = byPath.get(parentPath)!;
      expect(Math.hypot(p.x - parent.x, p.y - parent.y) + p.r).toBeLessThanOrEqual(parent.r + 1e-6);
      expect(p.depth).toBe(parent.depth + 1);
    }
    expect(byPath.get("src/a.rs")!.r).toBeGreaterThan(byPath.get("src/b.rs")!.r);
    const leaves = packed.filter((p) => p.node.item);
    for (let i = 0; i < leaves.length; i += 1) for (let j = i + 1; j < leaves.length; j += 1) expect(overlap(leaves[i], leaves[j])).toBe(false);
  });

  it("returns nothing for an empty tree", () => {
    expect(packTree(files([]), 100)).toEqual([]);
  });
});
