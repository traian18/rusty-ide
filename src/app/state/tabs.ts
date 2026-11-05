import { withActiveCanvas } from "../../features/canvas";
import { disposeTab } from "../tabs/effects";
import { getTabPolicy, pruneForClosedTab, seedForNewTab } from "../tabs/policy";
import { isDuplicateTab, nextInstanceId, originalTabId } from "../tabs/identity";
import { canDuplicateTab, findOpenTab, splitAfterActivating, splitPartner, splitWithCopy, visibleTabIds } from "../tabs/split";
import { fallbackTab, initialTabs } from "../tabs/transitions";
import { loadHasSeenOnboarding, saveHasSeenOnboarding } from "../../features/onboarding";
import type { OpenTabRequest, TabInstance, TabResolveContext, TabSplit } from "../tabs/types";
import type { WorkspaceSliceCreator } from "../../store/sliceTypes";
import type { WorkspaceState } from "../../store/types";

declare module "../../store/types" {
  interface WorkspaceState {
    /** The two code tabs shown side by side, if any (`src/app/tabs/split.ts`). */
    tabSplit: TabSplit | null;
    /** Splits the active code tab beside a copy of itself, or closes the split on screen. */
    toggleSplit: () => void;
  }
}

/**
 * The single open-tab collection. Replaces the previous `editorGroups` /
 * `activeGroupId` / `groupSizes` split-editor model: one tab strip, one outlet,
 * and every behavioral decision delegated to `src/tabs/policy.ts` rather than
 * re-derived at each call site. Showing two code tabs side by side is a view
 * over that one collection (`tabSplit`, see `src/tabs/split.ts`).
 */

function resolveContext(state: WorkspaceState): TabResolveContext {
  return {
    rootPath: state.rootPath,
    existingIds: state.tabs.map((tab) => tab.id),
    existingCanvasIds: Object.keys(state.canvasContexts ?? {}),
  };
}

export const createTabsSlice: WorkspaceSliceCreator = (set, get) => ({
  ...initialTabs(false),
  tabSplit: null,

  hydrateTabs: () => {
    const seen = loadHasSeenOnboarding();
    if (seen) {
      set((state) => {
        const isInitialDefault =
          state.tabs.length === 2 &&
          state.tabs.some((t) => t.type === "onboarding") &&
          state.tabs.some((t) => t.type === "workspace") &&
          state.activeTabId === "onboarding";

        if (isInitialDefault) {
          return withActiveCanvas(state, initialTabs(true));
        }
        return {};
      });
    } else {
      saveHasSeenOnboarding(true);
    }
  },

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
          tabSplit: splitAfterActivating(state.tabSplit, merged),
        });
      }

      const created = policy.create(request as never, identity, ctx) as TabInstance;
      // Only runs on create, never on re-open: re-opening an agent tab must
      // not wipe the conversation the first open accumulated.
      const seeded = seedForNewTab(created, state);

      return withActiveCanvas(state, {
        tabs: [...state.tabs, created],
        activeTabId: identity,
        tabSplit: splitAfterActivating(state.tabSplit, created),
        ...seeded,
      });
    });

    return resultId;
  },

  activateTab: (id: string) =>
    set((state) => {
      const tab = state.tabs.find((candidate) => candidate.id === id);
      if (!tab) return {};
      return withActiveCanvas(state, { activeTabId: id, tabSplit: splitAfterActivating(state.tabSplit, tab) });
    }),

  closeTab: (id: string) => {
    const tab = get().tabs.find((candidate) => candidate.id === id);
    if (!tab) return;
    if (!getTabPolicy(tab.type).closable) return;

    if (tab.type === "onboarding") {
      saveHasSeenOnboarding(true);
    }

    set((state) => {
      const index = state.tabs.findIndex((candidate) => candidate.id === id);
      let tabs = state.tabs.filter((candidate) => candidate.id !== id);
      const pruned = pruneForClosedTab(tab, state);

      let activeTabId = state.activeTabId;
      const partner = splitPartner(state.tabSplit, id);
      if (activeTabId === id) {
        // The other side of a split stays on screen, so focus goes there.
        // Otherwise the neighbour to the right, then to the left. The previous
        // behavior jumped to the last tab in the strip, which threw focus
        // across the window when closing anything but the rightmost tab.
        activeTabId = partner ?? (tabs[index] ?? tabs[index - 1])?.id ?? null;
      }

      if (tabs.length === 0) {
        const fallback = fallbackTab(loadHasSeenOnboarding());
        tabs = [fallback];
        activeTabId = fallback.id;
      }

      const tabSplit = partner
        ? null
        : splitAfterActivating(state.tabSplit, tabs.find((candidate) => candidate.id === activeTabId));
      return withActiveCanvas(state, { tabs, activeTabId, tabSplit, ...pruned });
    });

    // Non-store cleanup runs after the state write, never inside the updater.
    disposeTab(tab);
  },

  toggleSplit: () => {
    const { tabs, activeTabId, tabSplit } = get();
    if (!tabSplit) {
      const active = tabs.find((tab) => tab.id === activeTabId);
      if (active && canDuplicateTab(active)) set((state) => withActiveCanvas(state, splitWithCopy(state.tabs, active)));
      return;
    }
    // Behind a full-width tab there is no split on screen to close.
    if (visibleTabIds(activeTabId, tabSplit).length < 2) return;
    // A copy is only there to sit beside its original, so it closes with the split.
    const { left, right } = tabSplit;
    if (originalTabId(left) === originalTabId(right)) get().closeTab(isDuplicateTab(left) ? left : right);
    else set({ tabSplit: null });
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
