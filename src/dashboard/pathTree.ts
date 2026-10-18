/**
 * Files as a folder tree, for the whole-project maps. A folder whose only child is another folder
 * is merged into it (`crates/core/src` reads as one frame), so the maps do not draw empty rings.
 */
export interface PathNode<T> {
  /** The last segment, or several joined by `/` when folders were merged. */
  name: string;
  /** Repository-relative; empty for the root. */
  path: string;
  children: PathNode<T>[];
  /** Set on files only. */
  item?: T;
  /** The file's weight, or the sum below a folder. */
  weight: number;
  files: number;
}

const folder = <T>(name: string, path: string): PathNode<T> => ({ name, path, children: [], weight: 0, files: 0 });

function collapse<T>(node: PathNode<T>): PathNode<T> {
  node.children = node.children.map(collapse);
  if (node.path && node.children.length === 1 && !node.children[0].item) {
    const only = node.children[0];
    return { ...only, name: `${node.name}/${only.name}` };
  }
  return node;
}

function total<T>(node: PathNode<T>): void {
  if (node.item) return;
  node.children.forEach(total);
  node.weight = node.children.reduce((sum, child) => sum + child.weight, 0);
  node.files = node.children.reduce((sum, child) => sum + child.files, 0);
}

export function pathTree<T>(items: readonly T[], pathOf: (item: T) => string, weight: (item: T) => number): PathNode<T> {
  const root = folder<T>("", "");
  const folders = new Map<string, PathNode<T>>([["", root]]);
  for (const item of items) {
    const path = pathOf(item);
    const parts = path.split("/");
    let parent = root;
    for (let depth = 0; depth < parts.length - 1; depth += 1) {
      const at = parts.slice(0, depth + 1).join("/");
      let next = folders.get(at);
      if (!next) {
        next = folder(parts[depth], at);
        folders.set(at, next);
        parent.children.push(next);
      }
      parent = next;
    }
    parent.children.push({ name: parts[parts.length - 1], path, children: [], item, weight: Math.max(0, weight(item)), files: 1 });
  }
  const tree = collapse(root);
  // The root keeps its place even when everything sits under one folder: that folder is then the only package.
  total(tree);
  return tree;
}
