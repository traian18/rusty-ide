import { describe, expect, it } from "vitest";
import { detailFor, FAR_BELOW, NEAR_FROM } from "./zoom";

describe("detailFor", () => {
  it("draws less when zoomed out and more when zoomed in", () => {
    expect(detailFor(0.1)).toBe("far");
    expect(detailFor(1)).toBe("mid");
    expect(detailFor(2.5)).toBe("near");
  });

  it("switches exactly at the thresholds", () => {
    expect(detailFor(FAR_BELOW - 0.001)).toBe("far");
    expect(detailFor(FAR_BELOW)).toBe("mid");
    expect(detailFor(NEAR_FROM - 0.001)).toBe("mid");
    expect(detailFor(NEAR_FROM)).toBe("near");
  });
});
