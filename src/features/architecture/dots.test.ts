import { describe, expect, it } from "vitest";
import { packDots } from "./dots";

const overlap = (a: { x: number; y: number; r: number }, b: { x: number; y: number; r: number }) => Math.hypot(a.x - b.x, a.y - b.y) < a.r + b.r;

describe("packDots", () => {
  it("returns nothing for nothing", () => {
    expect(packDots([], 50)).toEqual([]);
    expect(packDots([3], 0)).toEqual([]);
  });

  it("puts a single dot in the middle", () => {
    const [dot] = packDots([5], 40);
    expect(dot.x).toBeCloseTo(0);
    expect(dot.y).toBeCloseTo(0);
  });

  it("keeps every dot inside the circle and apart from the others", () => {
    for (const sizes of [[9, 4, 4, 1], [30, 20, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1], Array<number>(12).fill(3)]) {
      const dots = packDots(sizes, 60);
      expect(dots).toHaveLength(sizes.length);
      for (const dot of dots) expect(Math.hypot(dot.x, dot.y) + dot.r).toBeLessThanOrEqual(60);
      for (let i = 0; i < dots.length; i++) for (let j = i + 1; j < dots.length; j++) expect(overlap(dots[i], dots[j])).toBe(false);
    }
  });

  it("sizes dots by file count and is deterministic", () => {
    const dots = packDots([16, 4, 1], 60);
    expect(dots[0].r).toBeGreaterThan(dots[1].r);
    expect(dots[1].r).toBeGreaterThan(dots[2].r);
    expect(packDots([16, 4, 1], 60)).toEqual(dots);
  });
});
