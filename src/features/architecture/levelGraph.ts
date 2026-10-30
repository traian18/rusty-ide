/**
 * Builds the canvas content of a level from its aggregated nodes and edges: sizes, tones, badges,
 * parents, and the items the layout needs. Positions come later from `layoutLevel`. Pure.
 */
import { nodeColor, nodeSlots } from "./palette";
import { RELATION_LABEL } from "./model";
import { bandWidth, bubbleDiameter, languageLegend, languageMix, nodeSize, toneFor, type Aggregated, type ColorBy, type LegendEntry } from "./aggregate";
import type { CanvasEdge, CanvasGraph, CanvasNode } from "./graphModel";
import { totalFindings, worstSeverity } from "./graphModel";
import { groupKey, type NodeKey } from "./identity";
import type { Box, LayoutItem, LayoutLink } from "./layoutElk";
import type { FindingBadges, LevelView, RelationKind, Severity, SeverityCounts } from "./model";
import { MAJOR_COUNT } from "./zoom";

const WORKSPACE_FRAME = groupKey("frame:workspace");
const DIRECTORY_PREFIX = "dir:";
/** A bubble's box is at least as wide as its name, so neighbours are spaced apart; matches the label's CSS limit. */
const MAX_LABEL_WIDTH = 220;

export interface LevelCanvas {
  viewKey: string;
  nodes: CanvasNode[];
  edges: CanvasEdge[];
  items: LayoutItem[];
  links: LayoutLink[];
  /** Item that frames all top-level items; its box is computed from them. */
  frame: string | null;
  legend: LegendEntry[];
  foldedCount: number;
  hiddenEdges: number;
}

export interface LevelCanvasOptions {
  viewKey: string;
  colorBy: ColorBy;
  /** Draw the whole level inside one workspace frame. */
  frame: boolean;
  frameLabel: string;
}

const sumCounts = (counts: SeverityCounts[]): SeverityCounts | null => {
  if (!counts.length) return null;
  const sum = { high: 0, medium: 0, low: 0, info: 0 };
  for (const c of counts) {
    sum.high += c.high;
    sum.medium += c.medium;
    sum.low += c.low;
    sum.info += c.info;
  }
  return totalFindings(sum) ? sum : null;
};

/** Findings for a node: its group's counts, or for a derived directory the files under it. */
export function badgesFor(id: string, badges: FindingBadges | null, files: readonly string[] = []): SeverityCounts | null {
  if (!badges) return null;
  if (files.length) return sumCounts(files.flatMap((file) => badges.by_file[file] ?? []));
  if (!id.startsWith(DIRECTORY_PREFIX)) return badges.by_group[id] ?? null;
  const prefix = `${id.slice(DIRECTORY_PREFIX.length)}/`;
  return sumCounts(Object.entries(badges.by_file).filter(([file]) => file.startsWith(prefix)).map(([, counts]) => counts));
}

/** Tones 10-13 are the severities (high to info); -1 is neutral. */
export const SEVERITY_TONE_BASE = 10;
const severityTone = (severity: Severity | null) => (severity === null ? -1 : SEVERITY_TONE_BASE + ["high", "medium", "low", "info"].indexOf(severity));

/** "3 routes · 1 renders" for the relation counts of one framework edge. */
export function describeKinds(kinds: Partial<Record<RelationKind, number>>): string {
  return (Object.entries(kinds) as [RelationKind, number][])
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
    .map(([kind, count]) => `${count} ${RELATION_LABEL[kind]}`)
    .join(" · ");
}

export function levelCanvas(
  aggregated: Aggregated,
  badges: FindingBadges | null,
  noted: ReadonlySet<NodeKey>,
  options: LevelCanvasOptions,
): LevelCanvas {
  const legend = languageLegend(aggregated.nodes);
  const hasChildren = new Set(aggregated.nodes.map((node) => node.parent).filter((parent): parent is string => parent !== null));

  const largest = Math.max(0, ...aggregated.nodes.filter((node) => !hasChildren.has(node.id)).map((node) => node.file_count));
  const slots = nodeSlots(aggregated.nodes.filter((node) => !node.synthetic).map((node) => node.id));
  const major = new Set(
    aggregated.nodes
      .filter((node) => !hasChildren.has(node.id))
      .sort((a, b) => b.file_count - a.file_count || (a.id < b.id ? -1 : 1))
      .slice(0, MAJOR_COUNT)
      .map((node) => node.id),
  );
  const nodes: CanvasNode[] = aggregated.nodes.map((node) => {
    const counts = node.folded.length ? null : badgesFor(node.id, badges, node.files);
    const container = hasChildren.has(node.id);
    const bubble = !container;
    // A node that holds small circles needs room for them, whatever its file count.
    const diameter = Math.max(bubbleDiameter(node.file_count, largest), node.children.length ? Math.min(170, 84 + 8 * node.children.length) : 0);
    // A bubble's box leaves room for its name underneath; containers are sized by the layout.
    const labelWidth = Math.min(MAX_LABEL_WIDTH, Math.round(node.label.length * 7.5) + 24);
    const size = bubble ? { width: Math.max(diameter, labelWidth), height: diameter + 38 } : nodeSize(node.file_count);
    const key = groupKey(node.id);
    const tone = options.colorBy === "severity" ? severityTone(worstSeverity(counts)) : toneFor(node, options.colorBy, legend);
    return {
      id: key,
      type: "group",
      label: node.label,
      subtitle: `${node.file_count} file${node.file_count === 1 ? "" : "s"}${node.basis === "inferred" ? " · inferred" : ""}`,
      basis: node.basis,
      badges: counts,
      worst: worstSeverity(counts),
      hasNote: noted.has(key),
      position: { x: 0, y: 0 },
      parentId: node.parent !== null ? groupKey(node.parent) : options.frame ? WORKSPACE_FRAME : null,
      width: size.width,
      height: size.height,
      tone,
      color: nodeColor(slots.get(node.id), tone, options.colorBy === "node", node.synthetic),
      inCycle: node.in_cycle,
      container,
      fold: node.folded.length > 0,
      synthetic: node.synthetic,
      languages: node.languages,
      bubble,
      diameter,
      major: major.has(node.id),
      detail: languageMix(node.languages),
      children: node.children,
      moreChildren: node.more_children,
      fileCount: node.file_count,
    };
  });

  if (options.frame && nodes.length > 0) {
    nodes.unshift({
      id: WORKSPACE_FRAME,
      type: "frame",
      label: options.frameLabel,
      subtitle: "",
      basis: null,
      badges: null,
      worst: null,
      hasNote: false,
      position: { x: 0, y: 0 },
      parentId: null,
      width: null,
      height: null,
      tone: -1,
      inCycle: false,
      container: true,
      fold: false,
      synthetic: true,
    });
  }

  const colorOf = new Map(nodes.map((node) => [node.id, node.color ?? ""]));
  const edges: CanvasEdge[] = aggregated.edges.map((edge) => ({
    id: edge.id,
    source: groupKey(edge.from),
    target: groupKey(edge.to),
    weight: edge.weight,
    typeOnly: edge.runtime === 0,
    label: "",
    selectedLabel: `${edge.weight} import${edge.weight === 1 ? "" : "s"}${edge.runtime && edge.typeOnly ? ` (${edge.typeOnly} type-only)` : ""}`,
    thickness: bandWidth(edge.weight),
    inCycle: edge.inCycle,
    fromColor: colorOf.get(groupKey(edge.from)),
    toColor: colorOf.get(groupKey(edge.to)),
  }));

  const items: LayoutItem[] = nodes.map((node) => ({
    id: node.id,
    parent: node.parentId ?? null,
    width: node.width ?? 0,
    height: node.height ?? 0,
  }));
  // The layout follows imports; framework relations are drawn over it without moving anything.
  const links: LayoutLink[] = edges.filter((edge) => !edge.framework).map((edge) => ({ id: edge.id, from: edge.source, to: edge.target }));
  for (const edge of aggregated.frameworkEdges) {
    edges.push({
      id: edge.id,
      source: groupKey(edge.from),
      target: groupKey(edge.to),
      weight: edge.count,
      typeOnly: false,
      label: "",
      selectedLabel: describeKinds(edge.kinds),
      framework: true,
    });
  }
  return { viewKey: options.viewKey, nodes, edges, items, links, frame: options.frame && nodes.length > 0 ? WORKSPACE_FRAME : null, legend, foldedCount: aggregated.foldedCount, hiddenEdges: aggregated.hiddenEdges };
}

/** Applies a layout to a level: positions, frame sizes, and (after a fallback) flat parents. */
export function placeLevel(canvas: LevelCanvas, boxes: Record<string, Box>, flattened: boolean): CanvasGraph {
  const placed = canvas.nodes
    .map((node) => {
      const box = boxes[node.id];
      return {
        ...node,
        position: box ? { x: box.x, y: box.y } : node.position,
        width: node.container || node.type === "frame" ? (box?.width ?? node.width) : node.width,
        height: node.container || node.type === "frame" ? (box?.height ?? node.height) : node.height,
        parentId: flattened ? null : node.parentId,
        container: flattened ? false : node.container,
      };
    })
    // xyflow needs a parent to come before its children.
    .sort((a, b) => depth(a, canvas) - depth(b, canvas));
  return { viewKey: canvas.viewKey, nodes: flattened ? placed.filter((node) => node.type !== "frame") : placed, edges: canvas.edges, hiddenByFilter: 0 };
}

function depth(node: CanvasNode, canvas: LevelCanvas): number {
  let count = 0;
  let parent = node.parentId ?? null;
  const byId = new Map(canvas.nodes.map((n) => [n.id, n]));
  while (parent !== null && count < 32) {
    count++;
    parent = byId.get(parent as NodeKey)?.parentId ?? null;
  }
  return count;
}

export interface LevelFilter {
  search: string;
  onlyWithFindings: boolean;
}

/** Drops nodes that do not match the filters, and the edges that touched them. */
export function filterLevelView(view: LevelView, badges: FindingBadges | null, filter: LevelFilter): { view: LevelView; hidden: number } {
  const query = filter.search.trim().toLowerCase();
  if (!query && !filter.onlyWithFindings) return { view, hidden: 0 };
  const nodes = view.nodes.filter(
    (node) =>
      (!query || node.label.toLowerCase().includes(query) || node.id.toLowerCase().includes(query)) &&
      (!filter.onlyWithFindings || totalFindings(badgesFor(node.id, badges, node.files)) > 0),
  );
  const ids = new Set(nodes.map((node) => node.id));
  return {
    view: { ...view, nodes, edges: view.edges.filter((edge) => ids.has(edge.from) && ids.has(edge.to)) },
    hidden: view.nodes.length - nodes.length,
  };
}
