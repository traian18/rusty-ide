/**
 * Turns host responses into the nodes and edges the canvas draws. Pure: filtering, badges, notes
 * markers, and layout all happen here, so the canvas component only renders. Generated nodes and
 * edges are built from query results every time and are never stored or edited.
 */
import { fileKey, type NodeKey } from "./identity";
import { layoutGraph, type Point } from "./layout";
import type {
  FindingBadges, GroupBasis, GroupGraph, ImportKind, LevelChild, Severity, SeverityCounts,
} from "./model";

export interface ViewFilter {
  search: string;
  importKind: "all" | ImportKind;
  onlyWithFindings: boolean;
}

export const NO_FILTER: ViewFilter = { search: "", importKind: "all", onlyWithFindings: false };

/** A type alias (not an interface) so it satisfies xyflow's `Record<string, unknown>` data constraint. */
export type CanvasNode = {
  id: NodeKey;
  type: "group" | "file" | "frame";
  label: string;
  subtitle: string;
  basis: GroupBasis | null;
  badges: SeverityCounts | null;
  worst: Severity | null;
  hasNote: boolean;
  position: Point;
  // Levelled view only.
  parentId?: NodeKey | null;
  width?: number | null;
  height?: number | null;
  /** Palette slot (-1 neutral). */
  tone?: number;
  inCycle?: boolean;
  /** True when other nodes are drawn inside this one. */
  container?: boolean;
  /** True for the `+N more` node. */
  fold?: boolean;
  synthetic?: boolean;
  /** Small circles previewing this node's components, and how many more there are. */
  children?: LevelChild[];
  moreChildren?: number;
  languages?: Record<string, number>;
  /** Drawn as a circle (leaf nodes of the levelled view) rather than a card. */
  bubble?: boolean;
  diameter?: number;
  /** Keeps its name even when zoomed far out. */
  major?: boolean;
  /** Language mix text shown when zoomed in. */
  detail?: string;
  fileCount?: number;
  /** CSS colour of the node (bubbles). */
  color?: string;
};

export interface CanvasEdge {
  id: string;
  source: NodeKey;
  target: NodeKey;
  /** Number of import sites the edge stands for. */
  weight: number;
  typeOnly: boolean;
  label: string;
  /** Shown only while one of the edge's nodes is selected (levelled view). */
  selectedLabel?: string;
  /** Stroke width in pixels. */
  thickness?: number;
  inCycle?: boolean;
  /** A framework relation (route, injection, render, command), drawn apart from imports. */
  framework?: boolean;
  /** CSS colours of the node it leaves and the node it reaches (levelled view). */
  fromColor?: string;
  toColor?: string;
}

export interface CanvasGraph {
  viewKey: string;
  nodes: CanvasNode[];
  edges: CanvasEdge[];
  /** Nodes removed by the filter, so the UI can say so. */
  hiddenByFilter: number;
}

export const SEVERITY_ORDER: readonly Severity[] = ["high", "medium", "low", "info"];

export function worstSeverity(counts: SeverityCounts | null | undefined): Severity | null {
  if (!counts) return null;
  return SEVERITY_ORDER.find((severity) => counts[severity] > 0) ?? null;
}

export function totalFindings(counts: SeverityCounts | null | undefined): number {
  return counts ? counts.high + counts.medium + counts.low + counts.info : 0;
}

export const groupViewKey = (groupId: string) => `group:${groupId}`;

const matches = (text: string, query: string) => text.toLowerCase().includes(query.trim().toLowerCase());

export function groupDrillGraph(
  graph: GroupGraph,
  badges: FindingBadges | null,
  noted: ReadonlySet<NodeKey>,
  saved: Readonly<Record<string, Point>>,
  filter: ViewFilter = NO_FILTER,
  showFrameworks = false,
): CanvasGraph {
  const keep = (file: string) =>
    (!filter.search.trim() || matches(file, filter.search)) &&
    (!filter.onlyWithFindings || totalFindings(badges?.by_file[file]) > 0);
  const visible = graph.nodes.filter((node) => keep(node.file));
  const visibleIds = new Set(visible.map((node) => node.file));

  const edges: CanvasEdge[] = [];
  const byPair = new Map<string, CanvasEdge>();
  for (const edge of graph.edges) {
    if (filter.importKind !== "all" && edge.kind !== filter.importKind) continue;
    if (!visibleIds.has(edge.from) || !visibleIds.has(edge.to)) continue;
    const id = `${edge.from}->${edge.to}`;
    const existing = byPair.get(id);
    if (existing) {
      existing.weight += 1;
      existing.label = String(existing.weight);
      existing.typeOnly = existing.typeOnly && edge.kind === "type_only";
    } else {
      const created: CanvasEdge = { id, source: fileKey(edge.from), target: fileKey(edge.to), weight: 1, typeOnly: edge.kind === "type_only", label: "1" };
      byPair.set(id, created);
      edges.push(created);
    }
  }

  if (showFrameworks) {
    const seenPairs = new Map<string, CanvasEdge>();
    for (const relation of graph.framework_edges ?? []) {
      if (!visibleIds.has(relation.from) || !visibleIds.has(relation.to)) continue;
      const id = `fw:${relation.from}->${relation.to}`;
      const existing = seenPairs.get(id);
      if (existing) {
        existing.weight += 1;
        existing.selectedLabel = `${existing.weight} framework relations`;
      } else {
        const created: CanvasEdge = { id, source: fileKey(relation.from), target: fileKey(relation.to), weight: 1, typeOnly: false, label: relation.label, selectedLabel: relation.label, framework: true };
        seenPairs.set(id, created);
        edges.push(created);
      }
    }
  }

  const nodes: CanvasNode[] = visible.map((node) => {
    const counts = badges?.by_file[node.file] ?? null;
    const id = fileKey(node.file);
    const name = node.file.split("/").pop() ?? node.file;
    return {
      id,
      type: "file",
      label: name,
      subtitle: node.file,
      basis: null,
      badges: counts,
      worst: worstSeverity(counts),
      hasNote: noted.has(id),
      position: { x: 0, y: 0 },
    };
  });
  return finish(groupViewKey(graph.group.id), nodes, edges, saved, graph.nodes.length - visible.length);
}

function finish(
  viewKey: string,
  nodes: CanvasNode[],
  edges: CanvasEdge[],
  saved: Readonly<Record<string, Point>>,
  hiddenByFilter: number,
): CanvasGraph {
  const positions = layoutGraph(
    nodes.map((node) => ({ key: node.id })),
    edges.map((edge) => ({ from: edge.source, to: edge.target })),
    saved,
  );
  return {
    viewKey,
    nodes: nodes.map((node) => ({ ...node, position: positions[node.id] ?? node.position })),
    edges,
    hiddenByFilter,
  };
}
