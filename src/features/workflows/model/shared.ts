/**
 * behaviorModel.ts — pure document helpers for the Behaviors canvas.
 *
 * The canvas edits two kinds of rusty-core JSON document:
 * - behavior profiles (`.rusty/profiles/<id>.json`, schema
 *   `behavior-profile-v1`), drawn as nodes with `switch_profile` rules as
 *   edges between them;
 * - orchestration workflows (`.rusty/workflows/<id>.json`), drawn as a step
 *   graph whose agent steps drill into their profile.
 *
 * Documents are kept as plain JSON so fields this editor does not know about
 * survive a load/save round trip. Canvas positions live in
 * `metadata.editor.position`, which rusty-core ignores.
 */

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

export type JsonObject = { [key: string]: Json };


export interface Position {
  x: number;
  y: number;
}


/** One validation problem, as returned by `behavior_validate_*`. */
export interface Issue {
  path: string;
  code: string;
  message: string;
  blocking: boolean;
}


export function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}


export function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/* ------------------------------------------------------------------ */
/*  Positions                                                          */
/* ------------------------------------------------------------------ */


export function positionOf(item: Json | undefined): Position | undefined {
  if (!isObject(item) || !isObject(item.metadata)) return undefined;
  const editor = item.metadata.editor;
  if (!isObject(editor) || !isObject(editor.position)) return undefined;
  const { x, y } = editor.position;
  return typeof x === "number" && typeof y === "number" ? { x, y } : undefined;
}


export function withPosition<T extends JsonObject>(item: T, position: Position): T {
  const next = clone(item);
  const metadata = isObject(next.metadata) ? next.metadata : {};
  const editor = isObject(metadata.editor) ? metadata.editor : {};
  editor.position = { x: Math.round(position.x), y: Math.round(position.y) };
  metadata.editor = editor;
  (next as JsonObject).metadata = metadata;
  return next;
}


/** Grid slot for the `index`th item without a stored position. */
export function gridPosition(index: number, columns = 3): Position {
  return { x: 60 + (index % columns) * 340, y: 60 + Math.floor(index / columns) * 240 };
}


/** The room a node needs on the canvas: its own size plus a margin to see edges and labels. */
export const NODE_SLOT = { width: 340, height: 250 };


/** Least horizontal distance between two connected steps in a row, so an edge and its label stay visible. */
export const MIN_COLUMN_GAP = 400;


export const overlaps = (a: Position, b: Position) => Math.abs(a.x - b.x) < NODE_SLOT.width - 40 && Math.abs(a.y - b.y) < NODE_SLOT.height - 40;


/**
 * Positions with no node on top of another, in the order given: a node that
 * would cover one placed before it moves to the nearest free slot. Nodes that
 * do not collide keep exactly the position they have.
 */
export function separateOverlaps(entries: Array<[string, Position]>): Map<string, Position> {
  const placed: Position[] = [];
  const result = new Map<string, Position>();
  const offsets: Array<[number, number]> = [];
  for (let dx = -4; dx <= 4; dx += 1) for (let dy = -4; dy <= 4; dy += 1) if (dx || dy) offsets.push([dx, dy]);
  offsets.sort((a, b) => a[0] ** 2 + a[1] ** 2 - (b[0] ** 2 + b[1] ** 2) || a[1] - b[1] || a[0] - b[0]);
  for (const [id, wanted] of entries) {
    let position = wanted;
    if (placed.some((other) => overlaps(position, other))) {
      const free = offsets
        .map(([dx, dy]) => ({ x: wanted.x + dx * NODE_SLOT.width, y: wanted.y + dy * NODE_SLOT.height }))
        .find((candidate) => candidate.x >= 0 && candidate.y >= 0 && !placed.some((other) => overlaps(candidate, other)));
      if (free) position = free;
    }
    placed.push(position);
    result.set(id, position);
  }
  return result;
}


/**
 * Stretches the layout sideways when connected steps in the same row sit
 * closer than [`MIN_COLUMN_GAP`], as in workflows saved with the old tight
 * spacing, so every edge has room to be seen. A layout that is already
 * roomy is returned as it is.
 */
export function spreadColumns(positions: Map<string, Position>, edges: JsonObject[]): Map<string, Position> {
  let tightest = Infinity;
  for (const edge of edges) {
    const from = positions.get(String(edge.source));
    const to = positions.get(String(edge.target));
    if (!from || !to || Math.abs(from.y - to.y) >= NODE_SLOT.height / 2) continue;
    const gap = Math.abs(to.x - from.x);
    if (gap > 0) tightest = Math.min(tightest, gap);
  }
  if (!Number.isFinite(tightest) || tightest >= MIN_COLUMN_GAP) return positions;
  const factor = Math.min(2, MIN_COLUMN_GAP / tightest);
  const left = Math.min(...[...positions.values()].map((position) => position.x));
  return new Map([...positions].map(([id, position]) => [id, { x: Math.round(left + (position.x - left) * factor), y: position.y }]));
}

/* ------------------------------------------------------------------ */
/*  Profiles                                                           */
/* ------------------------------------------------------------------ */


export function uniqueId(used: Iterable<string>, base: string): string {
  const taken = new Set(used);
  if (!taken.has(base)) return base;
  let index = 2;
  while (taken.has(`${base}_${index}`)) index += 1;
  return `${base}_${index}`;
}


export function stableStringify(document: Json): string {
  return `${JSON.stringify(document, null, 2)}\n`;
}

