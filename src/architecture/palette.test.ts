import { describe, expect, it } from "vitest";
import { NEUTRAL_COLOR, nodeColor, nodeSlots, toneColor } from "./palette";

describe("palette", () => {
  it("maps tones to theme tokens, severities to status tokens, and the rest to neutral", () => {
    expect(toneColor(0)).toBe("var(--color-primary)");
    expect(toneColor(4)).toBe("var(--color-primary)");
    expect(toneColor(10)).toBe("var(--color-status-danger-solid)");
    expect(toneColor(13)).toBe("var(--color-border-default)");
    expect(toneColor(-1)).toBe(NEUTRAL_COLOR);
    expect(toneColor(99)).toBe(NEUTRAL_COLOR);
  });

  it("colours a node by its category slot or its tone, and synthetic nodes neutrally", () => {
    expect(nodeColor(2, 1, true, false)).toBe("var(--color-category-3)");
    expect(nodeColor(2, 1, false, false)).toBe("var(--color-status-success-solid)");
    expect(nodeColor(2, 1, true, true)).toBe(NEUTRAL_COLOR);
    expect(nodeColor(undefined, 1, true, false)).toBe("var(--color-status-success-solid)");
  });

  it("gives up to twelve nodes different slots", () => {
    const ids = Array.from({ length: 12 }, (_, i) => `group:p${i}`);
    expect(new Set(nodeSlots(ids).values()).size).toBe(12);
  });
});
