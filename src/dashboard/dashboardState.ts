/** Where the person is in the dashboard; it outlives the tab and starts afresh for another repository. */
import { create } from "zustand";

import type { FilesQuery } from "./model";
import type { Lens } from "./lenses";

export type DashboardPage = "docs" | "health" | "files";

export interface DashboardState {
  root: string | null;
  page: DashboardPage;
  /** The folder the table under the map is narrowed to; empty is the repository. */
  folder: string;
  lens: Lens;
  sizeBy: "lines" | "files";
  filters: FilesQuery;
  /** The file open in the drawer. */
  selected: string | null;
  setPage(page: DashboardPage): void;
  setFolder(path: string): void;
  setLens(lens: Lens): void;
  setSizeBy(size: "lines" | "files"): void;
  setFilters(filters: FilesQuery): void;
  select(file: string | null): void;
  claimRoot(root: string): void;
  reset(): void;
}

const initial = {
  root: null as string | null,
  page: "docs" as DashboardPage,
  folder: "",
  lens: "language" as Lens,
  sizeBy: "lines" as const,
  filters: { sort: "lines", descending: true } as FilesQuery,
  selected: null as string | null,
};

export const useDashboard = create<DashboardState>()((set) => ({
  ...initial,
  setPage: (page) => set({ page }),
  setFolder: (folder) => set({ folder }),
  setLens: (lens) => set({ lens }),
  setSizeBy: (sizeBy) => set({ sizeBy }),
  setFilters: (filters) => set({ filters }),
  select: (selected) => set({ selected }),
  // The page and lens are how the person likes to work; the rest belongs to one repository.
  claimRoot: (root) => set((state) => (state.root === root ? state : { ...initial, page: state.page, lens: state.lens, sizeBy: state.sizeBy, root })),
  reset: () => set({ ...initial }),
}));
