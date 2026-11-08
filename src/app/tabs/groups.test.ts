import { describe, expect, it } from "vitest";
import { moveTabBetweenGroups, type TabGroups } from "./groups";
import type { TabInstance } from "./types";

const file = (id: string): TabInstance => ({ id, type: "file", path: "/a.ts", title: "a.ts", status: "idle", dirty: false });
const settings: TabInstance = { id: "settings", type: "settings", title: "Settings", status: "idle", dirty: false };
const agent: TabInstance = { id: "agent", type: "agent", title: "Agent", status: "idle", dirty: false };
const groups: TabGroups = {
  left: { tabIds: ["file:/a.ts", "settings"], activeTabId: "file:/a.ts" },
  right: { tabIds: ["duplicate:file:/a.ts", "agent"], activeTabId: "agent" },
  focused: "left",
};
const tabs = [file("file:/a.ts"), settings, file("duplicate:file:/a.ts"), agent];

describe("moveTabBetweenGroups", () => {
  it("moves a non-file tab and selects it in the destination", () => {
    const result = moveTabBetweenGroups(groups, tabs, "settings", "right", 1);
    expect(result?.groups?.left.tabIds).toEqual(["file:/a.ts"]);
    expect(result?.groups?.right).toEqual({ tabIds: ["duplicate:file:/a.ts", "settings", "agent"], activeTabId: "settings" });
    expect(result?.groups?.focused).toBe("right");
  });

  it.each([["file:/a.ts", "right", "duplicate:file:/a.ts"], ["duplicate:file:/a.ts", "left", "file:/a.ts"]] as const)(
    "retains the destination file when moving %s to %s",
    (id, side, retained) => {
      const result = moveTabBetweenGroups(groups, tabs, id, side, 0);
      expect(result?.activeTabId).toBe(retained);
      expect(result?.removedTab?.id).toBe(id);
      expect(result?.tabs.map((tab) => tab.id)).not.toContain(id);
    },
  );

  it("collapses when the source rail becomes empty", () => {
    const result = moveTabBetweenGroups({ ...groups, left: { tabIds: ["settings"], activeTabId: "settings" } }, [settings, agent], "settings", "right", 0);
    expect(result?.groups).toBeNull();
    expect(result?.activeTabId).toBe("settings");
  });

  it("reorders tabs inside a rail", () => {
    const result = moveTabBetweenGroups(groups, tabs, "settings", "left", 0);
    expect(result?.groups?.left.tabIds).toEqual(["settings", "file:/a.ts"]);
  });

  it("ignores missing tabs", () => {
    expect(moveTabBetweenGroups(groups, tabs, "missing", "left", 0)).toBeNull();
  });
});
