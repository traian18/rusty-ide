import { describe, expect, it } from "vitest";
import { bandPath } from "./bands";

describe("bandPath", () => {
  it("bows to one side of a left-to-right line, and to the other when reversed", () => {
    const forward = bandPath(0, 0, 200, 0);
    const back = bandPath(200, 0, 0, 0);
    expect(forward.labelY).toBeLessThan(0);
    expect(back.labelY).toBeGreaterThan(0);
    expect(forward.labelX).toBe(100);
  });

  it("curves even short lines, and caps how far long ones bow", () => {
    expect(Math.abs(bandPath(0, 0, 40, 0).labelY)).toBeGreaterThan(10);
    expect(Math.abs(bandPath(0, 0, 4000, 0).labelY)).toBeLessThanOrEqual(70.1);
  });

  it("starts at the source and ends at the target", () => {
    expect(bandPath(10, 20, 110, 220).path).toMatch(/^M 10,20 Q .* 110,220$/);
  });

  it("does not produce NaN for coincident points", () => {
    const { path, labelX, labelY } = bandPath(5, 5, 5, 5);
    expect(path).toBe("M 5,5");
    expect([labelX, labelY]).toEqual([5, 5]);
  });
});
