import { moveTabBetweenGroups, type TabGroups, type TabGroupSide } from "./groups";
import { originalTabId } from "./identity";
import type { TabInstance, TabSplit } from "./types";

export function mergeRails(tabs: TabInstance[], activeTabId: string | null): TabInstance[] {
  return tabs.filter((tab) => {
    if (tab.type !== "file") return true;
    const matches = tabs.filter((candidate) => candidate.type === "file" && originalTabId(candidate.id) === originalTabId(tab.id));
    const retained = matches.find((candidate) => candidate.id === activeTabId) ?? matches[0];
    return tab.id === retained.id;
  });
}

export function railIds(split: TabSplit, tabs: TabInstance[], side: TabGroupSide): string[] {
  return split.rails?.[side] ?? (side === "right" ? [split.right] : tabs.filter((tab) => tab.id !== split.right).map((tab) => tab.id));
}

export function activateInRail(split: TabSplit, tabs: TabInstance[], id: string): TabSplit {
  const left = railIds(split, tabs, "left");
  const right = railIds(split, tabs, "right");
  const side = left.includes(id) ? "left" : right.includes(id) ? "right" : split.focused;
  const rails = { left, right };
  if (!rails[side].includes(id)) rails[side] = [...rails[side], id];
  return { ...split, [side]: id, focused: side, rails };
}

export function closeInRail(split: TabSplit, tabs: TabInstance[], id: string): { tabSplit: TabSplit | null; activeTabId: string } {
  const left = railIds(split, tabs, "left").filter((candidate) => candidate !== id);
  const right = railIds(split, tabs, "right").filter((candidate) => candidate !== id);
  const side = railIds(split, tabs, "left").includes(id) ? "left" : "right";
  const index = railIds(split, tabs, side).indexOf(id);
  const leftActive = split.left === id ? left[Math.min(Math.max(index - 1, 0), left.length - 1)] : split.left;
  const rightActive = split.right === id ? right[Math.min(Math.max(index - 1, 0), right.length - 1)] : split.right;
  if (!left.length || !right.length) return { tabSplit: null, activeTabId: left.length ? leftActive : rightActive };
  const tabSplit = { ...split, left: leftActive, right: rightActive, rails: { left, right } };
  return { tabSplit, activeTabId: tabSplit[tabSplit.focused] };
}

export function moveInRail(split: TabSplit, tabs: TabInstance[], id: string, side: TabGroupSide, index: number) {
  const groups: TabGroups = {
    left: { tabIds: railIds(split, tabs, "left"), activeTabId: split.left },
    right: { tabIds: railIds(split, tabs, "right"), activeTabId: split.right },
    focused: split.focused,
  };
  const result = moveTabBetweenGroups(groups, tabs, id, side, index);
  if (!result) return null;
  const next = result.groups;
  return {
    tabs: result.tabs,
    activeTabId: result.activeTabId,
    tabSplit: next ? {
      left: next.left.activeTabId, right: next.right.activeTabId, focused: next.focused,
      rails: { left: next.left.tabIds, right: next.right.tabIds },
    } : null,
  };
}
