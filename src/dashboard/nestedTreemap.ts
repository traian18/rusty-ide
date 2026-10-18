/** A treemap of the whole folder tree at once: folders are framed and labelled, files fill them. */
import type { PathNode } from "./pathTree";
import { squarify, type Rect } from "./squarify";

export interface FolderFrame<T> extends Rect {
  node: PathNode<T>;
  depth: number;
  /** Whether the frame has room for its name above its files. */
  labelled: boolean;
}

export interface FileCell<T> extends Rect {
  node: PathNode<T>;
  item: T;
}

export interface NestedLayout<T> {
  frames: FolderFrame<T>[];
  cells: FileCell<T>[];
}

export interface NestedOptions {
  /** Height of a folder's name strip. */
  header: number;
  /** Space between a frame and what it holds. */
  pad: number;
}

const DEFAULTS: NestedOptions = { header: 15, pad: 2 };
/** A frame narrower than this, or shorter than two headers, goes unlabelled. */
const LABEL_MIN_W = 40;
/** Children are only laid out where at least this much room is left. */
const MIN_INNER = 2;

export function nestedTreemap<T>(root: PathNode<T>, bounds: Rect, options: Partial<NestedOptions> = {}): NestedLayout<T> {
  const { header, pad } = { ...DEFAULTS, ...options };
  const layout: NestedLayout<T> = { frames: [], cells: [] };
  const place = (node: PathNode<T>, rect: Rect, depth: number) => {
    for (const { item: child, x, y, w, h } of squarify(node.children, (c) => c.weight, rect)) {
      if (child.item !== undefined) {
        layout.cells.push({ node: child, item: child.item, x, y, w, h });
        continue;
      }
      const labelled = w >= LABEL_MIN_W && h >= header * 2;
      layout.frames.push({ node: child, depth, labelled, x, y, w, h });
      const top = pad + (labelled ? header : 0);
      const inner = { x: x + pad, y: y + top, w: w - pad * 2, h: h - top - pad };
      if (inner.w >= MIN_INNER && inner.h >= MIN_INNER) place(child, inner, depth + 1);
    }
  };
  place(root, bounds, 0);
  return layout;
}
