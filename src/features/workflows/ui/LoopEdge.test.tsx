import { describe, expect, it } from "vitest";
import { loopPath } from "./LoopEdge";

/** The corner points of a path: every coordinate pair after M, L or Q. */
const points = (path: string) =>
  [...path.matchAll(/(-?[\d.]+),(-?[\d.]+)/g)].map(([, x, y]) => ({ x: Number(x), y: Number(y) }));

describe("loopPath", () => {
  it("runs below the lowest card instead of through the cards", () => {
    const { path, labelY } = loopPath({ x: 900, y: 140 }, { x: 300, y: 140 }, 260, 0);
    const ys = points(path).map((point) => point.y);
    expect(Math.max(...ys)).toBeGreaterThan(260);
    expect(labelY).toBe(Math.max(...ys));
    // It leaves the source to the right and enters the target from the left.
    const all = points(path);
    expect(all[1].x).toBeGreaterThan(900);
    expect(all.at(-1)).toEqual({ x: 300, y: 140 });
    expect(all.at(-2)!.x).toBeLessThan(300);
  });

  it("gives deeper lanes a lower run and wider stubs", () => {
    const inner = loopPath({ x: 900, y: 140 }, { x: 300, y: 140 }, 260, 0);
    const outer = loopPath({ x: 900, y: 140 }, { x: 300, y: 140 }, 260, 2);
    expect(outer.labelY).toBeGreaterThan(inner.labelY);
    expect(points(outer.path)[1].x).toBeGreaterThan(points(inner.path)[1].x);
  });
});
