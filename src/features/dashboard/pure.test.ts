import { describe, expect, it } from "vitest";

import { ago, compact } from "./format";
import { fill, legend, NEUTRAL } from "./lenses";
import { mapLevel, tile } from "./dashboard.testing";
import { squarify } from "./squarify";

describe("squarify", () => {
  it("fills the bounds with areas proportional to the weights", () => {
    const placed = squarify([6, 6, 4, 3, 2, 2, 1], (w) => w, { x: 0, y: 0, w: 600, h: 400 });
    expect(placed).toHaveLength(7);
    const area = placed.reduce((sum, p) => sum + p.w * p.h, 0);
    expect(area).toBeCloseTo(240_000, 3);
    for (const p of placed) {
      expect(p.w * p.h).toBeCloseTo((p.item / 24) * 240_000, 3);
      expect(p.x).toBeGreaterThanOrEqual(-1e-9);
      expect(p.x + p.w).toBeLessThanOrEqual(600 + 1e-6);
      expect(p.y + p.h).toBeLessThanOrEqual(400 + 1e-6);
    }
  });

  it("keeps tiles close to square and drops empty weights", () => {
    const placed = squarify(Array.from({ length: 20 }, () => 1), (w) => w, { x: 0, y: 0, w: 500, h: 400 });
    const worst = Math.max(...placed.map((p) => Math.max(p.w / p.h, p.h / p.w)));
    expect(worst).toBeLessThan(3);
    expect(squarify([0, 0], (w) => w, { x: 0, y: 0, w: 10, h: 10 })).toEqual([]);
  });
});

describe("lenses", () => {
  const level = mapLevel();

  it("paints the language by its rank in the whole repository", () => {
    expect(fill("language", tile("a", { languages: [["typescript", 1]] }), level)).toBe("var(--color-category-2)");
    expect(fill("language", tile("a", { languages: [] }), level)).toBe(NEUTRAL);
  });

  it("paints nothing for tiles a lens has no signal for", () => {
    expect(fill("churn", tile("a", { commits: 0 }), level)).toBe(NEUTRAL);
    expect(fill("dependents", tile("a", { dependents: 0 }), level)).toBe(NEUTRAL);
    expect(fill("owner", tile("a"), level)).toBe(NEUTRAL);
    expect(fill("findings", tile("a"), level)).toBe(NEUTRAL);
  });

  it("uses severity for findings and a ramp for churn", () => {
    expect(fill("findings", tile("a", { findings: { high: 1, medium: 0, low: 0, info: 0 } }), level)).toContain("danger");
    expect(fill("churn", tile("a", { commits: 4 }), level)).not.toBe(fill("churn", tile("a", { commits: 1 }), level));
  });

  it("has a legend for every lens whose colours come from the same functions", () => {
    expect(legend("language", level).map((r) => r.label)).toEqual(["rust", "typescript"]);
    expect(legend("language", level)[0].color).toBe(fill("language", tile("a"), level));
    for (const lens of ["churn", "dependents", "findings", "owner"] as const) expect(legend(lens, level).length).toBeGreaterThan(1);
  });
});

describe("format", () => {
  it("shortens numbers and times", () => {
    expect([compact(950), compact(12_345), compact(2_500_000)]).toEqual(["950", "12.3k", "2.5M"]);
    expect(ago(1_000, 1_000 * 1000 + 3 * 86_400_000)).toBe("3 days ago");
  });
});
