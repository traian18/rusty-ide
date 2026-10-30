/**
 * View state for the architecture tab: what the person is looking at, never what the repository
 * contains. Query results are fetched from the host and held by the data hooks, not copied here.
 */
import { create } from "zustand";
import type { NodeKey } from "./identity";
import type { ColorBy } from "./aggregate";
import { DEFAULT_EDGE_COVERAGE, DEFAULT_SPACING, openNode, trimTrail, type Step, type Trail } from "./levels";
import type { SavedView } from "./persistence";

export interface SavedViewport {
  x: number;
  y: number;
  zoom: number;
}

export type SidePanel = "inspector" | "findings" | "notes";

export interface ArchitectureViewState {
  /** The folders opened from the top; what is shown follows from it alone. */
  trail: Trail;
  colorBy: ColorBy;
  edgeCoverage: number;
  spacing: number;
  /** Draw framework relations (routes, injections, renders, commands) over the graph. */
  showFrameworks: boolean;
  /** The workspace folder or repository this state belongs to; a different one starts afresh. */
  root: string | null;
  /** Pan and zoom per view, kept while the tab is away so it comes back exactly as it was. */
  viewports: Record<string, SavedViewport>;
  importKind: "all" | "runtime" | "type_only";
  search: string;
  onlyWithFindings: boolean;
  selection: NodeKey | null;
  panel: SidePanel;
  /** Opens a node of the current level. */
  open(step: Step): void;
  /** Goes back up to the first `depth` steps (0 is the top). */
  goTo(depth: number): void;
  setColorBy(colorBy: ColorBy): void;
  setEdgeCoverage(percent: number): void;
  setSpacing(percent: number): void;
  setShowFrameworks(show: boolean): void;
  /** Starts afresh unless this state already belongs to `root`. */
  claimRoot(root: string): void;
  setViewport(viewKey: string, viewport: SavedViewport): void;
  setImportKind(kind: ArchitectureViewState["importKind"]): void;
  setSearch(search: string): void;
  setOnlyWithFindings(value: boolean): void;
  select(key: NodeKey | null): void;
  setPanel(panel: SidePanel): void;
  hydrate(view: SavedView): void;
  reset(): void;
}

const initial = {
  trail: [] as Trail,
  colorBy: "node" as ColorBy,
  edgeCoverage: DEFAULT_EDGE_COVERAGE,
  spacing: DEFAULT_SPACING,
  showFrameworks: false,
  root: null as string | null,
  viewports: {} as Record<string, SavedViewport>,
  importKind: "all" as const,
  search: "",
  onlyWithFindings: false,
  selection: null as NodeKey | null,
  panel: "inspector" as SidePanel,
};

export const useArchitectureView = create<ArchitectureViewState>()((set) => ({
  ...initial,
  open: (step) => set((state) => ({ trail: openNode(state.trail, step), selection: null, search: "" })),
  goTo: (depth) => set((state) => ({ trail: trimTrail(state.trail, depth), selection: null, search: "" })),
  setColorBy: (colorBy) => set({ colorBy }),
  setEdgeCoverage: (edgeCoverage) => set({ edgeCoverage }),
  setSpacing: (spacing) => set({ spacing }),
  setShowFrameworks: (showFrameworks) => set({ showFrameworks }),
  claimRoot: (root) => set((state) => (state.root === root ? state : { ...initial, root })),
  setViewport: (viewKey, viewport) => set((state) => ({ viewports: { ...state.viewports, [viewKey]: viewport } })),
  setImportKind: (importKind) => set({ importKind }),
  setSearch: (search) => set({ search }),
  setOnlyWithFindings: (onlyWithFindings) => set({ onlyWithFindings }),
  select: (selection) => set({ selection }),
  setPanel: (panel) => set({ panel }),
  hydrate: (view) => set({ importKind: view.importKind, colorBy: view.colorMode, edgeCoverage: view.edgeShare, spacing: view.spacing, showFrameworks: view.frameworks }),
  reset: () => set({ ...initial }),
}));
