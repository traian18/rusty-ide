import { describe, expect, it } from "vitest";
import { duplicateTabId, isDuplicateTab, originalTabId } from "./identity";
import { TAB_POLICIES } from "./policy";
import { canDuplicateTab, findOpenTab, splitAfterActivating, splitPartner, splitWithCopy, tabLabel, visibleTabIds } from "./split";
import type { TabInstance, TabSplit, TabType } from "./types";

function fileTab(path: string, id = `file:${path}`): TabInstance {
  return { id, type: "file", title: path.slice(1), status: "idle", dirty: false, path };
}

const agent: TabInstance = { id: "agent", type: "agent", title: "Agent", status: "idle", dirty: false };
const split: TabSplit = { left: "file:/a.ts", right: "file:/b.ts", focused: "left" };

describe("duplicate tab ids", () => {
  it("round-trips, and leaves every other id alone", () => {
    const copy = duplicateTabId("file:/a.ts");
    expect(isDuplicateTab(copy)).toBe(true);
    expect(originalTabId(copy)).toBe("file:/a.ts");
    expect(isDuplicateTab("file:/a.ts")).toBe(false);
    expect(originalTabId("agent")).toBe("agent");
  });

  it("does not take a file's own name for a copy", () => {
    expect(isDuplicateTab("file:/notes#2.md")).toBe(false);
  });
});

describe("canDuplicateTab", () => {
  it("allows code tabs and nothing else", () => {
    const types = Object.keys(TAB_POLICIES) as TabType[];
    expect(types.filter((type) => canDuplicateTab({ type }))).toEqual(["file"]);
  });
});

describe("tabLabel", () => {
  it("marks only the copy", () => {
    expect(tabLabel({ id: "file:/a.ts", title: "a.ts" })).toBe("a.ts");
    expect(tabLabel({ id: duplicateTabId("file:/a.ts"), title: "a.ts" })).toBe("a.ts (2)");
  });
});

describe("visibleTabIds", () => {
  it("is the active tab alone without a split", () => {
    expect(visibleTabIds("agent", null)).toEqual(["agent"]);
    expect(visibleTabIds(null, null)).toEqual([]);
  });

  it("is both sides while either is active", () => {
    expect(visibleTabIds(split.left, split)).toEqual([split.left, split.right]);
    expect(visibleTabIds(split.right, split)).toEqual([split.left, split.right]);
  });

  it("leaves a split waiting behind a full-width tab", () => {
    expect(visibleTabIds("agent", split)).toEqual(["agent"]);
  });
});

describe("splitAfterActivating", () => {
  it("moves focus between the sides", () => {
    expect(splitAfterActivating(split, fileTab("/b.ts"))?.focused).toBe("right");
    expect(splitAfterActivating({ ...split, focused: "right" }, fileTab("/a.ts"))?.focused).toBe("left");
  });

  it("puts another code tab on the focused side, keeping the two-tab limit", () => {
    expect(splitAfterActivating(split, fileTab("/c.ts"))).toEqual({ ...split, left: "file:/c.ts" });
    expect(splitAfterActivating({ ...split, focused: "right" }, fileTab("/c.ts"))).toEqual({
      left: split.left,
      right: "file:/c.ts",
      focused: "right",
    });
  });

  it("keeps a non-code tab out of the split", () => {
    expect(splitAfterActivating(split, agent)).toBe(split);
  });

  it("does nothing without a split", () => {
    expect(splitAfterActivating(null, fileTab("/a.ts"))).toBeNull();
  });
});

describe("splitPartner", () => {
  it("finds the other side, and nothing for a tab off the split", () => {
    expect(splitPartner(split, split.left)).toBe(split.right);
    expect(splitPartner(split, split.right)).toBe(split.left);
    expect(splitPartner(split, "agent")).toBeUndefined();
    expect(splitPartner(null, split.left)).toBeUndefined();
  });
});

describe("findOpenTab", () => {
  const original = fileTab("/a.ts");
  const copy = fileTab("/a.ts", duplicateTabId("file:/a.ts"));

  it("finds a plain tab", () => {
    expect(findOpenTab({ tabs: [agent], activeTabId: null, tabSplit: null }, "agent")).toBe(agent);
    expect(findOpenTab({ tabs: [agent], activeTabId: null, tabSplit: null }, "file:/a.ts")).toBeUndefined();
  });

  it("prefers the active copy of a file", () => {
    const state = { tabs: [original, copy], activeTabId: copy.id, tabSplit: { left: original.id, right: copy.id, focused: "right" as const } };
    expect(findOpenTab(state, "file:/a.ts")).toBe(copy);
  });

  it("prefers a copy on screen over one that is not", () => {
    const state = { tabs: [original, copy, fileTab("/b.ts")], activeTabId: "file:/b.ts", tabSplit: { left: "file:/b.ts", right: copy.id, focused: "left" as const } };
    expect(findOpenTab(state, "file:/a.ts")).toBe(copy);
  });

  it("falls back to the original", () => {
    expect(findOpenTab({ tabs: [original, copy], activeTabId: null, tabSplit: null }, "file:/a.ts")).toBe(original);
  });

  it("still finds a copy whose original was closed", () => {
    expect(findOpenTab({ tabs: [copy], activeTabId: null, tabSplit: null }, "file:/a.ts")).toBe(copy);
  });
});

describe("splitWithCopy", () => {
  const original = fileTab("/a.ts");
  const copyId = duplicateTabId(original.id);

  it("adds the copy right after its original and focuses it", () => {
    const { tabs, activeTabId, tabSplit } = splitWithCopy([original, agent], original);
    expect(tabs.map((tab) => tab.id)).toEqual([original.id, copyId, "agent"]);
    expect(tabs[1]).toMatchObject({ type: "file", path: "/a.ts" });
    expect(activeTabId).toBe(copyId);
    expect(tabSplit).toMatchObject({ left: original.id, right: copyId, focused: "right" });
  });

  it("reuses an open copy rather than making a third tab of the file", () => {
    const copy = fileTab("/a.ts", copyId);
    expect(splitWithCopy([original, agent, copy], original).tabs).toHaveLength(3);
  });

  it("works from a copy whose original was closed", () => {
    const copy = fileTab("/a.ts", copyId);
    const { tabs, tabSplit } = splitWithCopy([copy], copy);
    expect(tabs.map((tab) => tab.id)).toEqual([copyId, original.id]);
    expect(tabSplit).toMatchObject({ left: copyId, right: original.id, focused: "right" });
  });
});
