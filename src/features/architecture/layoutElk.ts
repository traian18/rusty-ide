/**
 * Layered layout for the levelled view, computed by ELK behind a small interface so tests can use
 * the real engine and the app can run it in a worker. Input is sorted and ELK gets a fixed seed,
 * so the same graph always gives the same positions. If ELK fails or takes too long the in-house
 * layout is used instead and the result says so. Pinned (dragged) positions win over both.
 * Pure apart from the injected engine: no React, store, or Tauri imports.
 */
import { layoutGraph, type Point } from "./layout";

export interface ElkNodeLike {
  id: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  children?: ElkNodeLike[];
  edges?: { id: string; sources: string[]; targets: string[] }[];
  layoutOptions?: Record<string, string>;
}

export interface ElkLike {
  layout(graph: ElkNodeLike): Promise<ElkNodeLike>;
}

export interface LayoutItem {
  id: string;
  /** Another item in the same input that contains this one. */
  parent: string | null;
  width: number;
  height: number;
}

export interface LayoutLink {
  id: string;
  from: string;
  to: string;
}

export interface LevelLayoutInput {
  items: readonly LayoutItem[];
  links: readonly LayoutLink[];
  /**
   * An item that frames every top-level item. It is not laid out: its box is the bounding box of
   * the top-level items plus padding, and they are positioned relative to it.
   */
  frame?: string | null;
  /** Distance between nodes as a percentage of the base distance (default 100). */
  spacing?: number;
  /** Positions the person set by dragging; relative to the parent, like the output. */
  pinned?: Readonly<Record<string, Point>>;
}

export interface Box extends Point {
  width: number;
  height: number;
}

export interface LevelLayout {
  /** Position and size of every item; for nested items the position is relative to the parent. */
  boxes: Record<string, Box>;
  /** "elk" normally; "fallback" when the in-house layout was used (items are then flat). */
  engine: "elk" | "fallback";
  /** True when parents were dropped because the fallback layout cannot nest. */
  flattened: boolean;
}

const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
export const ELK_TIMEOUT_MS = 8_000;
const FRAME_PADDING = { side: 28, top: 48, bottom: 28 };

/** Flat levels use a stress layout (compact clusters); nested ones need the layered algorithm's compounds. */
const stressOptions = (scale: number): Record<string, string> => ({
  "elk.algorithm": "stress",
  "elk.randomSeed": "1",
  "elk.stress.desiredEdgeLength": String(Math.round(260 * scale)),
  "elk.spacing.nodeNode": String(Math.round(70 * scale)),
});

const layeredOptions = (scale: number): Record<string, string> => ({
  "elk.algorithm": "layered",
  "elk.direction": "RIGHT",
  "elk.randomSeed": "1",
  "elk.hierarchyHandling": "INCLUDE_CHILDREN",
  "elk.spacing.nodeNode": String(Math.round(36 * scale)),
  "elk.layered.spacing.nodeNodeBetweenLayers": String(Math.round(90 * scale)),
  "elk.edgeRouting": "POLYLINE",
});
const COMPOUND_PADDING = "[top=40,left=16,bottom=16,right=16]";

function buildElkGraph(items: readonly LayoutItem[], links: readonly LayoutLink[], options: Record<string, string>): ElkNodeLike {
  const sorted = [...items].sort((a, b) => compare(a.id, b.id));
  const known = new Set(sorted.map((item) => item.id));
  const nodes = new Map<string, ElkNodeLike>();
  for (const item of sorted) nodes.set(item.id, { id: item.id, width: item.width, height: item.height });
  const root: ElkNodeLike = { id: "root", layoutOptions: options, children: [], edges: [] };
  for (const item of sorted) {
    const node = nodes.get(item.id)!;
    const parent = item.parent !== null && known.has(item.parent) ? nodes.get(item.parent) : undefined;
    if (parent) {
      (parent.children ??= []).push(node);
      // A compound node is sized by its children.
      parent.layoutOptions = { ...options, "elk.padding": COMPOUND_PADDING };
      delete parent.width;
      delete parent.height;
    } else root.children!.push(node);
  }
  for (const link of [...links].sort((a, b) => compare(a.id, b.id))) {
    if (link.from === link.to || !known.has(link.from) || !known.has(link.to)) continue;
    root.edges!.push({ id: link.id, sources: [link.from], targets: [link.to] });
  }
  return root;
}

function readBoxes(node: ElkNodeLike, into: Record<string, Box>) {
  for (const child of node.children ?? []) {
    into[child.id] = { x: child.x ?? 0, y: child.y ?? 0, width: child.width ?? 0, height: child.height ?? 0 };
    readBoxes(child, into);
  }
}

const withTimeout = <T,>(work: Promise<T>, ms: number): Promise<T> =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("layout timed out")), ms);
    work.then(
      (value) => (clearTimeout(timer), resolve(value)),
      (error) => (clearTimeout(timer), reject(error)),
    );
  });

function fallbackLayout(input: { items: readonly LayoutItem[]; links: readonly LayoutLink[] }): LevelLayout {
  const points = layoutGraph(
    input.items.map((item) => ({ key: item.id })),
    input.links.map((link) => ({ from: link.from, to: link.to })),
  );
  const boxes: Record<string, Box> = {};
  for (const item of input.items) boxes[item.id] = { ...(points[item.id] ?? { x: 0, y: 0 }), width: item.width, height: item.height };
  return { boxes, engine: "fallback", flattened: input.items.some((item) => item.parent !== null) };
}

/** Wraps the top-level boxes in a frame and makes their positions relative to it. */
function applyFrame(layout: LevelLayout, items: readonly LayoutItem[], frame: string): LevelLayout {
  const top = items.filter((item) => item.parent === null && layout.boxes[item.id]);
  if (!top.length) return layout;
  const minX = Math.min(...top.map((item) => layout.boxes[item.id].x));
  const minY = Math.min(...top.map((item) => layout.boxes[item.id].y));
  const maxX = Math.max(...top.map((item) => layout.boxes[item.id].x + layout.boxes[item.id].width));
  const maxY = Math.max(...top.map((item) => layout.boxes[item.id].y + layout.boxes[item.id].height));
  const originX = minX - FRAME_PADDING.side;
  const originY = minY - FRAME_PADDING.top;
  const boxes = { ...layout.boxes };
  for (const item of top) boxes[item.id] = { ...boxes[item.id], x: boxes[item.id].x - originX, y: boxes[item.id].y - originY };
  boxes[frame] = { x: originX, y: originY, width: maxX - minX + 2 * FRAME_PADDING.side, height: maxY - minY + FRAME_PADDING.top + FRAME_PADDING.bottom };
  return { ...layout, boxes };
}

export async function layoutLevel(input: LevelLayoutInput, elk: ElkLike | null, timeoutMs = ELK_TIMEOUT_MS): Promise<LevelLayout> {
  const frame = input.frame ?? null;
  // The frame is drawn around the result, not laid out, so the layout sees a flat set where it can.
  const items = (frame ? input.items.filter((item) => item.id !== frame) : [...input.items]).map((item) =>
    frame && item.parent === frame ? { ...item, parent: null } : item,
  );
  const links = frame ? input.links.filter((link) => link.from !== frame && link.to !== frame) : input.links;
  const nested = items.some((item) => item.parent !== null);
  const scale = Math.max(0.3, (input.spacing ?? 100) / 100);

  let layout: LevelLayout;
  if (elk === null) layout = fallbackLayout({ items, links });
  else {
    try {
      const graph = buildElkGraph(items, links, nested ? layeredOptions(scale) : stressOptions(scale));
      const result = await withTimeout(elk.layout(graph), timeoutMs);
      const boxes: Record<string, Box> = {};
      readBoxes(result, boxes);
      layout = { boxes, engine: "elk", flattened: false };
    } catch {
      layout = fallbackLayout({ items, links });
    }
  }
  if (frame) layout = applyFrame(layout, items, frame);
  for (const [id, point] of Object.entries(input.pinned ?? {})) {
    const box = layout.boxes[id];
    if (box) layout.boxes[id] = { ...box, x: point.x, y: point.y };
  }
  return layout;
}
