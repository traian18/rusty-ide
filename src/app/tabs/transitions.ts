/**
 * Pure tab-collection transitions for app-level events.
 *
 * These live outside the workspace slice so they can be tested without that
 * slice's `localStorage` and `invoke` baggage (ARCHITECTURE.md's slice
 * import-time purity rule).
 */

import { getTabPolicy } from "./policy";
import type { TabInstance } from "./types";

function makeSingletonTab(type: "workspace"): TabInstance {
  const policy = getTabPolicy(type);
  return policy.create({ type } as never, type, {
    rootPath: "",
    existingIds: [],
    existingCanvasIds: [],
  });
}

/** The tab shown when the strip would otherwise be empty. */
export function fallbackTab(): TabInstance {
  return makeSingletonTab("workspace");
}

/** The app starts on the workspace picker. */
export function initialTabs(): { tabs: TabInstance[]; activeTabId: string } {
  const workspace = makeSingletonTab("workspace");
  return { tabs: [workspace], activeTabId: workspace.id };
}

/** Opening a workspace starts with an Agent tab ready to chat. */
export function tabsAfterWorkspaceChange(): {
  tabs: TabInstance[];
  activeTabId: string;
  dropped: TabInstance[];
} {
  const agent = getTabPolicy("agent").create({ type: "agent" }, "agent", {
    rootPath: "",
    existingIds: [],
    existingCanvasIds: [],
  });
  return { tabs: [agent], activeTabId: agent.id, dropped: [] };
}

/**
 * A branch change keeps the first canvas tab (or seeds the workspace's tabs)
 * and drops the rest. `dropped` is returned so the caller can prune and dispose
 * them — the previous implementation dropped tabs without pruning anything,
 * leaking a canvas context, chat history and VFS instance on every branch switch.
 */
export function tabsAfterBranchChange(state: { tabs: TabInstance[] }): {
  tabs: TabInstance[];
  activeTabId: string;
  dropped: TabInstance[];
} {
  const canvas = state.tabs.find((tab) => tab.type === "canvas");
  if (!canvas) {
    const seeded = tabsAfterWorkspaceChange();
    return { ...seeded, dropped: state.tabs };
  }
  return {
    tabs: [canvas],
    activeTabId: canvas.id,
    dropped: state.tabs.filter((tab) => tab.id !== canvas.id),
  };
}
