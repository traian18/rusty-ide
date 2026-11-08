import { originalTabId } from "./identity";
import type { TabInstance } from "./types";

export type TabGroupSide = "left" | "right";

export interface TabGroup {
  tabIds: string[];
  activeTabId: string;
}

export interface TabGroups {
  left: TabGroup;
  right: TabGroup;
  focused: TabGroupSide;
}

export interface MoveTabResult {
  groups: TabGroups | null;
  tabs: TabInstance[];
  activeTabId: string;
  /** A file instance removed because the destination already contained it. */
  removedTab: TabInstance | null;
}

function destinationDuplicate(tab: TabInstance, tabs: TabInstance[], targetIds: string[]): TabInstance | undefined {
  if (tab.type !== "file") return undefined;
  return tabs.find((candidate) => candidate.type === "file" && targetIds.includes(candidate.id)
    && originalTabId(candidate.id) === originalTabId(tab.id));
}

function remainingGroup(group: TabGroup, sourceIds: string[], tabId: string): TabGroup {
  if (group.activeTabId !== tabId) return { tabIds: sourceIds, activeTabId: group.activeTabId };
  const index = Math.min(group.tabIds.indexOf(tabId), sourceIds.length - 1);
  return { tabIds: sourceIds, activeTabId: sourceIds[index] };
}

/** Move or reorder an existing tab, keeping the destination's file instance on collision. */
export function moveTabBetweenGroups(
  groups: TabGroups,
  tabs: TabInstance[],
  tabId: string,
  destination: TabGroupSide,
  index: number,
): MoveTabResult | null {
  const source: TabGroupSide = groups.left.tabIds.includes(tabId) ? "left" : "right";
  if (!groups[source].tabIds.includes(tabId)) return null;
  const tab = tabs.find((candidate) => candidate.id === tabId);
  if (!tab) return null;

  const sourceIds = groups[source].tabIds.filter((id) => id !== tabId);
  const targetIds = source === destination ? sourceIds : [...groups[destination].tabIds];
  const duplicate = source !== destination ? destinationDuplicate(tab, tabs, targetIds) : undefined;
  const selectedId = duplicate?.id ?? tabId;
  if (!duplicate) targetIds.splice(Math.max(0, Math.min(index, targetIds.length)), 0, tabId);

  const remainingTabs = duplicate ? tabs.filter((candidate) => candidate.id !== tabId) : tabs;
  if (source !== destination && sourceIds.length === 0) {
    return { groups: null, tabs: remainingTabs, activeTabId: selectedId, removedTab: duplicate ? tab : null };
  }

  const nextGroups: TabGroups = {
    ...groups,
    [destination]: { tabIds: targetIds, activeTabId: selectedId },
    focused: destination,
  };
  if (source !== destination) {
    nextGroups[source] = remainingGroup(groups[source], sourceIds, tabId);
  }
  return { groups: nextGroups, tabs: remainingTabs, activeTabId: selectedId, removedTab: duplicate ? tab : null };
}
