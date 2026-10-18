/** Which written page is open in the project documentation; it outlives the tab being on screen. */
import { create } from "zustand";

export const OVERVIEW_PAGE = "written:overview";

export interface DocsViewState {
  /** The repository this state belongs to; a different one starts at its overview. */
  root: string | null;
  guidePage: string;
  selectGuide(id: string): void;
  claimRoot(root: string): void;
  reset(): void;
}

const initial = { root: null as string | null, guidePage: OVERVIEW_PAGE };

export const useDocsView = create<DocsViewState>()((set) => ({
  ...initial,
  selectGuide: (id) => set({ guidePage: id }),
  claimRoot: (root) => set((state) => (state.root === root ? state : { ...initial, root })),
  reset: () => set({ ...initial }),
}));
