/**
 * Turns a level's candidate nodes into something small enough to read: the most connected nodes
 * are kept, the rest fold into one `+N more` node, and weak edges are hidden (the counts of what
 * was folded and hidden are always reported). Also the encodings: size, thickness and colour tone.
 * Ranking is a documented lexicographic order, never a blended score. Pure.
 */
import type { ImportKind, LevelEdge, LevelNode, LevelView, RelationKind } from "./model";

export const FOLD_ID = "fold:more";

export interface AggregateOptions {
  /** Maximum nodes drawn, the fold node included. */
  cap: number;
  /** Share of the total edge weight to show, in percent (cycle edges are always kept). */
  coverage: number;
  /** Maximum edges drawn. */
  edgeCap: number;
  importKind: "all" | ImportKind;
  /** Include framework relations (off by default). */
  frameworks?: boolean;
}

export interface AggNode extends LevelNode {
  /** Ids folded into this node, when it is the fold node. */
  folded: string[];
}

export interface AggEdge {
  id: string;
  from: string;
  to: string;
  runtime: number;
  typeOnly: number;
  weight: number;
  inCycle: boolean;
}

export interface AggFrameworkEdge {
  id: string;
  from: string;
  to: string;
  kinds: Partial<Record<RelationKind, number>>;
  count: number;
}

/** Most framework edges drawn on one level. */
export const MAX_FRAMEWORK_EDGES = 60;

export interface Aggregated {
  frameworkEdges: AggFrameworkEdge[];
  nodes: AggNode[];
  edges: AggEdge[];
  foldedCount: number;
  totalEdges: number;
  hiddenEdges: number;
}

const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

function toEdge(edge: LevelEdge, importKind: AggregateOptions["importKind"]): AggEdge | null {
  const runtime = importKind === "type_only" ? 0 : edge.runtime;
  const typeOnly = importKind === "runtime" ? 0 : edge.type_only;
  const weight = runtime + typeOnly;
  if (weight === 0) return null;
  return { id: `${edge.from}->${edge.to}`, from: edge.from, to: edge.to, runtime, typeOnly, weight, inCycle: edge.in_cycle };
}

/** Edges ordered by weight (cycle edges first), cut by coverage and cap. */
export function thinEdges(edges: readonly AggEdge[], coverage: number, edgeCap: number): AggEdge[] {
  const ordered = [...edges].sort(
    (a, b) => Number(b.inCycle) - Number(a.inCycle) || b.weight - a.weight || compare(a.id, b.id),
  );
  const total = ordered.reduce((sum, edge) => sum + edge.weight, 0);
  const target = (total * Math.min(100, Math.max(0, coverage))) / 100;
  const kept: AggEdge[] = [];
  let shown = 0;
  for (const edge of ordered) {
    if (kept.length >= edgeCap) break;
    if (!edge.inCycle && shown >= target) break;
    kept.push(edge);
    shown += edge.weight;
  }
  return kept.sort((a, b) => compare(a.id, b.id));
}

export function aggregateLevel(view: LevelView, options: AggregateOptions): Aggregated {
  const edges = view.edges.map((edge) => toEdge(edge, options.importKind)).filter((edge): edge is AggEdge => edge !== null);
  const degree = new Map<string, number>();
  for (const edge of edges) {
    degree.set(edge.from, (degree.get(edge.from) ?? 0) + edge.weight);
    degree.set(edge.to, (degree.get(edge.to) ?? 0) + edge.weight);
  }
  const ranked = [...view.nodes].sort(
    (a, b) => (degree.get(b.id) ?? 0) - (degree.get(a.id) ?? 0) || b.file_count - a.file_count || compare(a.id, b.id),
  );
  const overflow = ranked.length > options.cap;
  const keepCount = overflow ? Math.max(1, options.cap - 1) : ranked.length;
  const kept = ranked.slice(0, keepCount);
  const folded = ranked.slice(keepCount);
  const keptIds = new Set(kept.map((node) => node.id));
  const byId = new Map(view.nodes.map((node) => [node.id, node]));

  // A kept node whose parent was folded moves up to its nearest kept ancestor.
  const keptParent = (node: LevelNode): string | null => {
    let parent = node.parent;
    while (parent !== null && !keptIds.has(parent)) parent = byId.get(parent)?.parent ?? null;
    return parent;
  };
  const nodes: AggNode[] = kept
    .map((node) => ({ ...node, parent: keptParent(node), folded: [] }))
    .sort((a, b) => compare(a.id, b.id));

  const foldedIds = new Set(folded.map((node) => node.id));
  if (folded.length) {
    nodes.push({
      id: FOLD_ID,
      label: `+${folded.length} more`,
      kind: folded[0].kind,
      basis: null,
      explanation: `${folded.length} less connected nodes folded together to keep this level readable.`,
      file_count: folded.reduce((sum, node) => sum + node.file_count, 0),
      languages: folded.reduce<Record<string, number>>((all, node) => {
        for (const [language, count] of Object.entries(node.languages)) all[language] = (all[language] ?? 0) + count;
        return all;
      }, {}),
      parent: null,
      children: [],
      more_children: 0,
      files: [],
      in_cycle: folded.some((node) => node.in_cycle),
      synthetic: true,
      folded: folded.map((node) => node.id).sort(compare),
    });
  }

  // Edges into folded nodes aggregate onto the fold node; edges between folded nodes disappear.
  const merged = new Map<string, AggEdge>();
  for (const edge of edges) {
    const from = foldedIds.has(edge.from) ? FOLD_ID : edge.from;
    const to = foldedIds.has(edge.to) ? FOLD_ID : edge.to;
    if (from === to) continue;
    const id = `${from}->${to}`;
    const existing = merged.get(id);
    if (existing) {
      existing.runtime += edge.runtime;
      existing.typeOnly += edge.typeOnly;
      existing.weight += edge.weight;
      existing.inCycle ||= edge.inCycle;
    } else merged.set(id, { ...edge, id, from, to });
  }
  const all = [...merged.values()];
  const shown = thinEdges(all, options.coverage, options.edgeCap);
  const frameworkEdges: AggFrameworkEdge[] = [];
  if (options.frameworks) {
    const byPair = new Map<string, AggFrameworkEdge>();
    for (const edge of view.framework_edges ?? []) {
      const from = foldedIds.has(edge.from) ? FOLD_ID : edge.from;
      const to = foldedIds.has(edge.to) ? FOLD_ID : edge.to;
      if (from === to) continue;
      const id = `fw:${from}->${to}`;
      const entry = byPair.get(id) ?? { id, from, to, kinds: {}, count: 0 };
      for (const [kind, count] of Object.entries(edge.kinds) as [RelationKind, number][]) {
        entry.kinds[kind] = (entry.kinds[kind] ?? 0) + count;
        entry.count += count;
      }
      byPair.set(id, entry);
    }
    frameworkEdges.push(...[...byPair.values()].sort((a, b) => b.count - a.count || compare(a.id, b.id)).slice(0, MAX_FRAMEWORK_EDGES));
  }
  return { nodes, edges: shown, frameworkEdges, foldedCount: folded.length, totalEdges: all.length, hiddenEdges: all.length - shown.length };
}

/** The language with the most files; ties go to the alphabetically first. */
export function dominantLanguage(languages: Readonly<Record<string, number>>): string | null {
  let best: string | null = null;
  for (const [language, count] of Object.entries(languages).sort(([a], [b]) => compare(a, b))) {
    if (best === null || count > languages[best]) best = language;
  }
  return best;
}

export interface Size {
  width: number;
  height: number;
}

/** Box size by file count on a square-root scale, so a 100x larger package is 10x, not 100x, bigger. */
export function nodeSize(fileCount: number): Size {
  const scale = Math.min(1, Math.sqrt(Math.max(0, fileCount)) / 20);
  return { width: Math.round(168 + 152 * scale), height: Math.round(64 + 56 * scale) };
}

/**
 * Circle diameter by file count on a square-root scale relative to the largest node on the level,
 * between 44 and 150 pixels, so differences show whether a repository has dozens of files or thousands.
 */
export function bubbleDiameter(fileCount: number, largest: number): number {
  const scale = largest > 0 ? Math.min(1, Math.sqrt(Math.max(0, fileCount) / largest)) : 0;
  return Math.round(44 + 106 * scale);
}

/** Width of the band that stands for an edge, by import count on a log scale between 2 and 16 pixels. */
export function bandWidth(weight: number): number {
  return Math.round((2 + Math.min(14, Math.log2(Math.max(1, weight)) * 1.7)) * 10) / 10;
}

/** The languages of a node as "typescript 60% · rust 40%", at most three. */
export function languageMix(languages: Readonly<Record<string, number>>): string {
  const total = Object.values(languages).reduce((sum, count) => sum + count, 0);
  if (total === 0) return "";
  return Object.entries(languages)
    .sort((a, b) => b[1] - a[1] || compare(a[0], b[0]))
    .slice(0, 3)
    .map(([language, count]) => `${language} ${Math.round((count / total) * 100)}%`)
    .join(" · ");
}

/** "node" gives every node its own colour; the others colour by a shared attribute. */
export type ColorBy = "node" | "language" | "kind" | "severity";
export const NEUTRAL_TONE = -1;
export const TONE_COUNT = 4;

export interface LegendEntry {
  label: string;
  tone: number;
  count: number;
}

/** Languages in use, most files first, each with a stable tone (cycling past the palette). */
export function languageLegend(nodes: readonly Pick<LevelNode, "languages">[]): LegendEntry[] {
  const totals = new Map<string, number>();
  for (const node of nodes) for (const [language, count] of Object.entries(node.languages)) totals.set(language, (totals.get(language) ?? 0) + count);
  return [...totals.entries()]
    .sort((a, b) => b[1] - a[1] || compare(a[0], b[0]))
    .map(([label, count], index) => ({ label, count, tone: index % TONE_COUNT }));
}

const KIND_TONE: Record<string, number> = { declared_package: 0, source_root: 1, directory: 2, import_cycle: 3 };

export function toneFor(node: Pick<LevelNode, "languages" | "kind" | "synthetic">, colorBy: ColorBy, legend: readonly LegendEntry[]): number {
  if (colorBy === "severity" || colorBy === "node") return NEUTRAL_TONE;
  if (colorBy === "kind") return node.synthetic ? NEUTRAL_TONE : (KIND_TONE[node.kind] ?? NEUTRAL_TONE);
  const language = dominantLanguage(node.languages);
  return language === null ? NEUTRAL_TONE : (legend.find((entry) => entry.label === language)?.tone ?? NEUTRAL_TONE);
}
