/**
 * Pure helpers for the visible pair and file-instance identity. Independent
 * rail membership lives on TabSplit; rail transitions are in rails.ts.
 */

import { duplicateTabId, isDuplicateTab, originalTabId } from "./identity";
import { getTabPolicy } from "./policy";
import type { TabInstance, TabSplit } from "./types";

export function canDuplicateTab(tab: { type: TabInstance["type"] }): boolean {
  return getTabPolicy(tab.type).duplicable === true;
}

/** What the tab strip calls a tab; the copy of a file reads apart from the original. */
export function tabLabel(tab: { id: string; title: string }): string {
  return isDuplicateTab(tab.id) ? `${tab.title} (2)` : tab.title;
}

/** The tabs on screen: both sides of the split while one of them is active, else the active tab. */
export function visibleTabIds(activeTabId: string | null, split: TabSplit | null): string[] {
  if (split && (activeTabId === split.left || activeTabId === split.right)) return [split.left, split.right];
  return activeTabId ? [activeTabId] : [];
}

/**
 * The split with `tab` active. A code tab it does not show yet takes the side
 * that had focus, so a file opened from the tree lands where the user is working.
 */
export function splitAfterActivating(split: TabSplit | null, tab: TabInstance | undefined): TabSplit | null {
  if (!split || !tab) return split;
  if (tab.id === split.left) return { ...split, focused: "left" };
  if (tab.id === split.right) return { ...split, focused: "right" };
  return canDuplicateTab(tab) ? { ...split, [split.focused]: tab.id } : split;
}

/** The other side of the split, when `tabId` is on it. */
export function splitPartner(split: TabSplit | null, tabId: string): string | undefined {
  if (split?.left === tabId) return split.right;
  if (split?.right === tabId) return split.left;
  return undefined;
}

/**
 * The open tab for `identity`. With two tabs of one file the one in use wins,
 * so Navigate Back or go-to-definition in the right-hand copy stays in it.
 */
export function findOpenTab(
  state: { tabs: TabInstance[]; activeTabId: string | null; tabSplit: TabSplit | null },
  identity: string,
): TabInstance | undefined {
  const matches = state.tabs.filter((tab) => originalTabId(tab.id) === identity);
  const focusedIds = state.tabSplit?.rails?.[state.tabSplit.focused] ?? [];
  return matches.find((tab) => focusedIds.includes(tab.id))
    ?? matches.find((tab) => tab.id === state.activeTabId)
    ?? matches.find((tab) => splitPartner(state.tabSplit, tab.id) !== undefined)
    ?? matches[0];
}

/** Opens `source` side by side with its copy, which takes focus. Reuses a copy that is already open. */
export function splitWithCopy(tabs: TabInstance[], source: TabInstance): {
  tabs: TabInstance[];
  activeTabId: string;
  tabSplit: TabSplit;
} {
  const copyId = isDuplicateTab(source.id) ? originalTabId(source.id) : duplicateTabId(source.id);
  const withCopy = tabs.some((tab) => tab.id === copyId)
    ? tabs
    : tabs.flatMap((tab) => (tab.id === source.id ? [tab, { ...source, id: copyId }] : [tab]));
  return { tabs: withCopy, activeTabId: copyId, tabSplit: {
    left: source.id, right: copyId, focused: "right",
    rails: { left: withCopy.filter((tab) => tab.id !== copyId).map((tab) => tab.id), right: [copyId] },
  } };
}
