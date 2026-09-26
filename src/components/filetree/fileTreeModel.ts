/**
 * fileTreeModel.ts
 *
 * Pure, DOM-free logic behind the project file explorer: which rows are
 * visible, what each key does, and how selections and moves are resolved.
 * Kept out of the React components so it can be unit-tested directly
 * (see fileTreeModel.test.ts) -- keyboard navigation in particular was
 * silently lost once when FileTree.tsx was rewritten, and these tests are
 * what now pins it down.
 */

export interface FileEntry {
  name: string;
  path: string;
  is_dir: boolean;
  children?: FileEntry[];
}

export type ExpandedPaths = Record<string, boolean | undefined>;

export interface TreeKeyInput {
  key: string;
  shiftKey?: boolean;
  metaKey?: boolean;
  ctrlKey?: boolean;
}

export interface TreeKeyContext {
  visible: FileEntry[];
  focusedPath: string | null;
  expanded: ExpandedPaths;
}

/**
 * What a key press should do. `focus` moves the focus ring (and, with
 * `extend`, adds the target to the selection instead of replacing it).
 */
export type TreeKeyAction =
  | { type: "focus"; path: string; extend: boolean }
  | { type: "expand"; path: string; open: boolean }
  | { type: "activate"; entry: FileEntry }
  | { type: "select"; path: string; toggle: boolean }
  | { type: "delete" };

/** Rows in on-screen order: every root entry plus the children of expanded folders. */
export function flattenVisible(entries: FileEntry[], expanded: ExpandedPaths): FileEntry[] {
  const result: FileEntry[] = [];
  const visit = (nodes: FileEntry[]) => {
    for (const node of nodes) {
      result.push(node);
      if (node.is_dir && expanded[node.path] && node.children) visit(node.children);
    }
  };
  visit(entries);
  return result;
}

/** Every entry in the tree (expanded or not), keyed by path. */
export function indexByPath(entries: FileEntry[]): Map<string, FileEntry> {
  const map = new Map<string, FileEntry>();
  const visit = (nodes: FileEntry[]) => {
    for (const node of nodes) {
      map.set(node.path, node);
      if (node.children) visit(node.children);
    }
  };
  visit(entries);
  return map;
}

export function parentDirOf(path: string): string {
  return path.substring(0, path.lastIndexOf("/"));
}

/** The folder new files/folders go into when created from `node`'s context menu. */
export function createTargetFor(node: FileEntry): { dir: string; name: string } {
  const dir = node.is_dir ? node.path : parentDirOf(node.path);
  return { dir, name: node.is_dir ? node.name : dir.split("/").pop() || "folder" };
}

/** Maps a key press to a tree action, or null when the tree should ignore the key. */
export function resolveTreeKey(input: TreeKeyInput, { visible, focusedPath, expanded }: TreeKeyContext): TreeKeyAction | null {
  if (visible.length === 0) return null;
  const foundIndex = visible.findIndex((node) => node.path === focusedPath);
  const index = foundIndex < 0 ? 0 : foundIndex;
  const current = visible[index];
  const extend = !!input.shiftKey;
  const focus = (entry: FileEntry | undefined): TreeKeyAction | null =>
    entry ? { type: "focus", path: entry.path, extend } : null;

  switch (input.key) {
    case "ArrowDown":
      return focus(visible[foundIndex < 0 ? 0 : Math.min(index + 1, visible.length - 1)]);
    case "ArrowUp":
      return focus(visible[foundIndex < 0 ? 0 : Math.max(index - 1, 0)]);
    case "ArrowRight":
      if (!current.is_dir) return null;
      if (!expanded[current.path]) return { type: "expand", path: current.path, open: true };
      return focus(visible[index + 1]);
    case "ArrowLeft":
      if (current.is_dir && expanded[current.path]) return { type: "expand", path: current.path, open: false };
      return focus(
        visible.slice(0, index).reverse().find((candidate) => candidate.is_dir && current.path.startsWith(`${candidate.path}/`)),
      );
    case "Enter":
      return { type: "activate", entry: current };
    case " ":
      return { type: "select", path: current.path, toggle: !!(input.metaKey || input.ctrlKey) };
    case "Delete":
      return { type: "delete" };
    case "Backspace":
      return input.metaKey || input.ctrlKey ? { type: "delete" } : null;
    default:
      return null;
  }
}

/** Shift-click: every visible row between the two paths, inclusive. Null if either is not visible. */
export function rangeSelection(visible: FileEntry[], fromPath: string, toPath: string): Set<string> | null {
  const from = visible.findIndex((entry) => entry.path === fromPath);
  const to = visible.findIndex((entry) => entry.path === toPath);
  if (from === -1 || to === -1) return null;
  return new Set(visible.slice(Math.min(from, to), Math.max(from, to) + 1).map((entry) => entry.path));
}

export function toggleInSelection(selection: Set<string>, path: string): Set<string> {
  const next = new Set(selection);
  if (next.has(path)) next.delete(path);
  else next.add(path);
  return next;
}

/**
 * Paths that can actually be moved into `destination`: drops duplicates,
 * paths nested under another moved path (they travel with their parent),
 * the destination itself, and any ancestor of it.
 */
export function movablePaths(paths: string[], destination: string): string[] {
  const unique = [...new Set(paths)];
  return unique
    .filter((path) => !unique.some((other) => other !== path && path.startsWith(`${other}/`)))
    .filter((path) => path !== destination && !destination.startsWith(`${path}/`));
}
