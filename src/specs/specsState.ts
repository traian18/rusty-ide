/** What is open on the Specs page; it outlives the tab and starts afresh for another repository. */
import { create } from "zustand";

export type Selection = { kind: "project" } | { kind: "capability"; name: string } | { kind: "change"; dir: string } | { kind: "archived"; dir: string } | null;

/** The documents of a change, in reading order; `tasks` is the checklist, the rest are files. */
export type ChangeTab = "overview" | "spec" | "research" | "design" | "tasks" | "verification";

export interface SpecsViewState {
  root: string | null;
  /** `null` until the person picks: the page then opens the first change, or the project. */
  selection: Selection;
  tab: ChangeTab;
  select(selection: Selection): void;
  setTab(tab: ChangeTab): void;
  claimRoot(root: string): void;
  reset(): void;
}

const initial = { root: null as string | null, selection: null as Selection, tab: "spec" as ChangeTab };

export const useSpecsView = create<SpecsViewState>()((set) => ({
  ...initial,
  select: (selection) => set({ selection }),
  setTab: (tab) => set({ tab }),
  claimRoot: (root) => set((state) => (state.root === root ? state : { ...initial, root })),
  reset: () => set({ ...initial }),
}));
