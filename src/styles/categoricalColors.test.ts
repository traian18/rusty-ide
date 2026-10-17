import { describe, expect, it } from "vitest";
import { assignCategories, CATEGORICAL_COLORS, CATEGORY_COUNT, categoricalCssVariables, categoryVar, hashString } from "./categoricalColors";

describe("categorical colours", () => {
  it("has the same number of distinct colours for both appearances", () => {
    for (const colors of Object.values(CATEGORICAL_COLORS)) {
      expect(colors).toHaveLength(CATEGORY_COUNT);
      expect(new Set(colors).size).toBe(CATEGORY_COUNT);
    }
  });

  it("exposes numbered CSS variables per appearance", () => {
    const dark = categoricalCssVariables("dark");
    expect(Object.keys(dark)).toEqual(Array.from({ length: 12 }, (_, i) => `--color-category-${i + 1}`));
    expect(dark["--color-category-1"]).not.toBe(categoricalCssVariables("light")["--color-category-1"]);
  });

  it("references slots by variable and wraps any integer around the palette", () => {
    expect(categoryVar(0)).toBe("var(--color-category-1)");
    expect(categoryVar(11)).toBe("var(--color-category-12)");
    expect(categoryVar(12)).toBe("var(--color-category-1)");
    expect(categoryVar(-1)).toBe("var(--color-category-12)");
  });

  it("hashes the same string the same way", () => {
    expect(hashString("a")).toBe(hashString("a"));
    expect(hashString("a")).not.toBe(hashString("b"));
  });

  it("never gives two of the first twelve keys the same slot", () => {
    const keys = Array.from({ length: 12 }, (_, i) => `package-${i}`);
    expect(new Set(assignCategories(keys).values()).size).toBe(12);
  });

  it("does not depend on input order and keeps a key's slot when unrelated keys are absent from its way", () => {
    const keys = ["engine", "web", "core", "cli", "api"];
    expect([...assignCategories(keys)]).toEqual([...assignCategories([...keys].reverse())]);
    expect(assignCategories(["engine"]).get("engine")).toBe(hashString("engine") % CATEGORY_COUNT);
  });

  it("reuses the least used slots beyond twelve keys, evenly", () => {
    const slots = assignCategories(Array.from({ length: 30 }, (_, i) => `k${i}`));
    const counts = new Array(CATEGORY_COUNT).fill(0);
    for (const slot of slots.values()) counts[slot]++;
    expect(Math.max(...counts) - Math.min(...counts)).toBeLessThanOrEqual(1);
  });

  it("ignores duplicate keys", () => {
    expect(assignCategories(["a", "a", "b"]).size).toBe(2);
  });
});
