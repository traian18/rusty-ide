import { describe, expect, it } from "vitest";
import { breadcrumb, focusOf, isSyntheticId, levelViewKey, openNode, trimTrail, type Trail } from "./levels";

const trail: Trail = [
  { id: "p:web", label: "web" },
  { id: "dir:web/src", label: "src" },
];

describe("breadcrumb", () => {
  it("is just the top at the start", () => {
    expect(breadcrumb([], "repo")).toEqual([{ label: "repo", depth: 0 }]);
  });

  it("has one crumb per step, each remembering how much of the trail it keeps", () => {
    expect(breadcrumb(trail, "repo")).toEqual([
      { label: "repo", depth: 0 },
      { label: "web", depth: 1 },
      { label: "src", depth: 2 },
    ]);
  });
});

describe("the trail", () => {
  it("focuses the last step, or nothing at the top", () => {
    expect(focusOf([])).toBeNull();
    expect(focusOf(trail)).toBe("dir:web/src");
  });

  it("remembers a layout per place", () => {
    expect(levelViewKey([])).toBe("level:");
    expect(levelViewKey(trail)).toBe("level:dir:web/src");
  });

  it("opens a node by adding a step", () => {
    expect(openNode([], { id: "p:web", label: "web" })).toEqual([{ id: "p:web", label: "web" }]);
    expect(openNode(trail, { id: "dir:web/src/ui", label: "ui" })).toHaveLength(3);
  });

  it("does not open the place it is already at, or nodes that stand for several things", () => {
    expect(openNode(trail, { id: "dir:web/src", label: "src" })).toBe(trail);
    for (const id of ["other", "rest:workspace", "fold:more"]) expect(openNode(trail, { id, label: id })).toBe(trail);
    expect(isSyntheticId("rest:dir:web/src")).toBe(false);
  });

  it("goes back up by cutting steps", () => {
    expect(trimTrail(trail, 1)).toEqual([trail[0]]);
    expect(trimTrail(trail, 0)).toEqual([]);
    expect(trimTrail(trail, -3)).toEqual([]);
    expect(trimTrail(trail, 9)).toEqual(trail);
  });
});
