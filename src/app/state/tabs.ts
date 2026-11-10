import { withActiveCanvas } from "../../features/canvas";
import { disposeTab } from "../tabs/effects";
import { getTabPolicy, pruneForClosedTab, seedForNewTab } from "../tabs/policy";
import { nextInstanceId } from "../tabs/identity";
import { canDuplicateTab, findOpenTab, splitWithCopy } from "../tabs/split";
import { activateInRail, closeInRail, mergeRails, moveInRail } from "../tabs/rails";
import type { TabGroupSide } from "../tabs/groups";
import { fallbackTab, initialTabs } from "../tabs/transitions";
import type { OpenTabRequest, TabInstance, TabResolveContext, TabSplit } from "../tabs/types";
import type { WorkspaceSliceCreator } from "../../store/sliceTypes";
import type { WorkspaceState } from "../../store/types";

declare module "../../store/types" {
  interface WorkspaceState {
    /** Visible tab IDs, focus, and ordered membership of the two rails. */
    tabSplit: TabSplit | null;
    moveTabToRail: (id: string, side: TabGroupSide, index?: number) => void;
    /** Merge the rails, or split by copying a file / moving a non-file tab. */
    toggleSplit: () => void;
  }
}

/** The registry is shared; split membership and selection belong to each rail. */

function resolveContext(state: WorkspaceState): TabResolveContext {
  return {
    rootPath: state.rootPath,
    existingIds: state.tabs.map((tab) => tab.id),
    existingCanvasIds: Object.keys(state.canvasContexts ?? {}),
  };
}

export const createTabsSlice: WorkspaceSliceCreator = (set, get) => ({
  ...initialTabs(),
  tabSplit: null,

  openTab: (request: OpenTabRequest) => {
    // Assigned inside the updater below. Zustand's `set` runs the updater
    // synchronously, so this is populated before the return statement -- it
    // reads like a race but is not one.
    let resultId = "";

    set((state) => {
      const policy = getTabPolicy(request.type);
      const ctx = resolveContext(state);

      const identity =
        policy.uniqueness === "multiple"
          ? nextInstanceId(request.type, ctx.existingIds)
          : policy.getIdentity(request as never, ctx);
      resultId = identity;

      // For `global` uniqueness `getIdentity` returns a constant, so this
      // lookup doubles as the singleton check with no special-casing.
      const existing = findOpenTab(state, identity);

      if (existing) {
        resultId = existing.id;
        const merged = policy.merge
          ? (policy.merge(existing as never, request as never) as TabInstance)
          : existing;
        const tabs =
          merged === existing
            ? state.tabs
            : state.tabs.map((tab) => (tab.id === existing.id ? merged : tab));
        return withActiveCanvas(state, {
          tabs,
          activeTabId: existing.id,
          tabSplit: state.tabSplit ? activateInRail(state.tabSplit, state.tabs, merged.id) : null,
        });
      }

      const created = policy.create(request as never, identity, ctx) as TabInstance;
      // Only runs on create, never on re-open: re-opening an agent tab must
      // not wipe the conversation the first open accumulated.
      const seeded = seedForNewTab(created, state);

      return withActiveCanvas(state, {
        tabs: [...state.tabs, created],
        activeTabId: identity,
        tabSplit: state.tabSplit ? activateInRail(state.tabSplit, state.tabs, created.id) : null,
        ...seeded,
      });
    });

    return resultId;
  },

  activateTab: (id: string) =>
    set((state) => {
      const tab = state.tabs.find((candidate) => candidate.id === id);
      if (!tab) return {};
      return withActiveCanvas(state, { activeTabId: id, tabSplit: state.tabSplit ? activateInRail(state.tabSplit, state.tabs, tab.id) : null });
    }),

  closeTab: (id: string) => {
    const tab = get().tabs.find((candidate) => candidate.id === id);
    if (!tab) return;
    if (!getTabPolicy(tab.type).closable) return;

    set((state) => {
      const index = state.tabs.findIndex((candidate) => candidate.id === id);
      let tabs = state.tabs.filter((candidate) => candidate.id !== id);
      const pruned = pruneForClosedTab(tab, state);

      let activeTabId = state.activeTabId;
      if (activeTabId === id) {
        activeTabId = (tabs[index] ?? tabs[index - 1])?.id ?? null;
      }

      if (tabs.length === 0) {
        const fallback = fallbackTab();
        tabs = [fallback];
        activeTabId = fallback.id;
      }

      const selection = state.tabSplit ? closeInRail(state.tabSplit, state.tabs, id) : { tabSplit: null, activeTabId };
      if (state.tabSplit && !selection.tabSplit) tabs = mergeRails(tabs, selection.activeTabId);
      return withActiveCanvas(state, { tabs, ...selection, ...pruned });
    });

    // Non-store cleanup runs after the state write, never inside the updater.
    disposeTab(tab);
  },

  moveTabToRail: (id, side, index = Number.MAX_SAFE_INTEGER) => set((state) => {
    if (!state.tabSplit) return {};
    const moved = moveInRail(state.tabSplit, state.tabs, id, side, index);
    if (!moved) return {};
    if (!moved.tabSplit) moved.tabs = mergeRails(moved.tabs, moved.activeTabId);
    return withActiveCanvas(state, moved);
  }),

  toggleSplit: () => {
    const { tabs, activeTabId, tabSplit } = get();
    if (!tabSplit) {
      const active = tabs.find((tab) => tab.id === activeTabId);
      if (active && canDuplicateTab(active)) {
        set((state) => withActiveCanvas(state, splitWithCopy(state.tabs, active)));
      } else if (active && tabs.length > 1) {
        const left = tabs.filter((tab) => tab.id !== active.id).map((tab) => tab.id);
        set({ tabSplit: { left: left[left.length - 1], right: active.id, focused: "right", rails: { left, right: [active.id] } } });
      }
      return;
    }
    set({ tabSplit: null, tabs: mergeRails(tabs, activeTabId) });
  },

  updateTab: (id: string, updates: Partial<Omit<TabInstance, "id" | "type">>) =>
    set((state) => {
      const index = state.tabs.findIndex((tab) => tab.id === id);
      if (index === -1) return {};
      const tabs = [...state.tabs];
      tabs[index] = { ...tabs[index], ...updates } as TabInstance;
      return { tabs };
    }),
});
