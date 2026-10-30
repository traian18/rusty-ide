/**
 * Where the person is in the file tree and how to get back. A position is the trail of folders
 * (or packages) opened from the top, so the same trail always shows the same level. Pure.
 */
export interface Step {
  /** A node id the host accepts as a focus: a package group, `dir:<path>` or `rest:<focus>`. */
  id: string;
  label: string;
}

/** The nodes opened from the top, outermost first; empty at the top. */
export type Trail = readonly Step[];

/** Nodes drawn at one level before the rest fold into a `+N more` node. */
export const LEVEL_CAP = 40;
export const MAX_EDGES_DRAWN = 120;
export const DEFAULT_EDGE_COVERAGE = 100;
/** Spacing between nodes as a percentage of the layout's base distance. */
export const DEFAULT_SPACING = 160;
export const MIN_SPACING = 80;
export const MAX_SPACING = 300;

export interface Crumb {
  label: string;
  /** Steps kept when this crumb is chosen. */
  depth: number;
}

/** The top, then one crumb per step; the last one is the current place. */
export function breadcrumb(trail: Trail, topLabel: string): Crumb[] {
  return [{ label: topLabel, depth: 0 }, ...trail.map((step, index) => ({ label: step.label, depth: index + 1 }))];
}

/** The focus whose contents are shown: the last step, or the top when the trail is empty. */
export const focusOf = (trail: Trail): string | null => trail.at(-1)?.id ?? null;

/** Layout and pan are remembered per place. */
export const levelViewKey = (trail: Trail) => `level:${focusOf(trail) ?? ""}`;

/** Nodes that stand for several unrelated things, so there is nothing of their own to open. The loose files of a folder (`rest:<folder>`) are a real group and open like one. */
export const isSyntheticId = (id: string) => id === "other" || id === "rest:workspace" || id.startsWith("fold:");

/** The trail after opening a node, or the same trail when the node cannot be opened. */
export function openNode(trail: Trail, step: Step): Trail {
  return isSyntheticId(step.id) || focusOf(trail) === step.id ? trail : [...trail, step];
}

/** The trail cut back to its first `depth` steps. */
export const trimTrail = (trail: Trail, depth: number): Trail => trail.slice(0, Math.max(0, depth));
