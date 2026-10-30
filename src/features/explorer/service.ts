/** File-tree operations: refreshing the tree, creating, deleting, moving and renaming files. */
import type { ExplorerClient } from "./client";
import type { ConfirmFn, FileActionParams, FileEntry } from "./model";

/** What the explorer needs from the workspace; the app supplies it (see ui/explorerService.ts). */
export interface ExplorerApp {
  rootPath(): string | null;
  setFileTree(tree: FileEntry[]): void;
  loadGitStatus(): Promise<void>;
  setPathExpanded(path: string, expanded: boolean): void;
  /** The open file tabs, so deleting a file can close its tab. */
  openFileTabs(): { id: string; path: string }[];
  closeTab(id: string): void;
  tabIdForPath(path: string): string;
  setLastRename(rename: { originalPath: string; newPath: string }): void;
  notify(title: string, message: string, kind: "success" | "error" | "info"): void;
  revealInFolder(path: string): Promise<void>;
}

const normalize = (path: string) => path.replace(/\\/g, "/");

/** Drops duplicates and items inside another item that is also being deleted. */
function topLevelItems(items: FileActionParams[]): FileActionParams[] {
  return items.filter(
    (item, idx, self) =>
      self.findIndex((other) => other.path === item.path) === idx &&
      !self.some((other) => other.path !== item.path && normalize(item.path).startsWith(`${normalize(other.path)}/`)),
  );
}

function deleteConfirmation(items: FileActionParams[]) {
  const single = items.length === 1;
  return {
    title: single ? "Confirm Delete" : `Confirm Delete (${items.length} items)`,
    message: single
      ? `Are you sure you want to permanently delete "${items[0].name}"? This action cannot be undone.`
      : `Are you sure you want to permanently delete ${items.length} items? This action cannot be undone.`,
    confirmLabel: single ? "Delete" : `Delete ${items.length} Items`,
    cancelLabel: "Cancel",
    kind: "danger" as const,
  };
}

export function createExplorerService(client: ExplorerClient, app: ExplorerApp) {
  let activeRefresh: Promise<void> | null = null;
  let refreshRequestedWhileActive = false;
  let scheduledRefresh: ReturnType<typeof setTimeout> | null = null;

  async function performTreeRefresh(): Promise<void> {
    const rootPath = app.rootPath();
    if (!rootPath) return;
    try {
      app.setFileTree(await client.tree(rootPath));
      await app.loadGitStatus();
    } catch (err) {
      console.error("Failed to refresh file tree structure:", err);
    }
  }

  async function refreshTree(): Promise<void> {
    if (scheduledRefresh) {
      clearTimeout(scheduledRefresh);
      scheduledRefresh = null;
    }
    if (activeRefresh) {
      refreshRequestedWhileActive = true;
      return activeRefresh;
    }

    activeRefresh = performTreeRefresh().finally(() => {
      activeRefresh = null;
      if (refreshRequestedWhileActive) {
        refreshRequestedWhileActive = false;
        scheduleTreeRefresh();
      }
    });
    return activeRefresh;
  }

  /** Coalesce command completions into one explorer/Git refresh. */
  function scheduleTreeRefresh(delayMs = 750): void {
    if (scheduledRefresh) clearTimeout(scheduledRefresh);
    scheduledRefresh = setTimeout(() => {
      scheduledRefresh = null;
      void refreshTree();
    }, delayMs);
  }

  async function create(kind: "file" | "folder", parentDir: string, name: string): Promise<void> {
    const path = `${parentDir}/${name}`;
    const label = kind === "file" ? "File" : "Folder";
    try {
      await (kind === "file" ? client.createFile(path) : client.createDirectory(path));
      await refreshTree();
      app.setPathExpanded(parentDir, true);
      app.notify(`${label} Created`, `Successfully created ${kind}: ${name}`, "success");
    } catch (err) {
      console.error(`Failed to create ${kind}:`, err);
      app.notify("Create failed", `Create ${kind} failed: ${err}`, "error");
      throw err;
    }
  }

  /** Moves `from` to `to`, then closes the old file's tab and remembers the move for undo. */
  async function relocate(from: string, to: string, done: string, failed: string): Promise<void> {
    if (from === to) return;
    try {
      await client.move(from, to);
      await refreshTree();
      app.closeTab(app.tabIdForPath(from));
      app.setLastRename({ originalPath: from, newPath: to });
      app.notify(done, `${done === "Item Moved" ? "Moved to" : "Renamed to"}: ${to.split("/").pop()}`, "success");
    } catch (err) {
      console.error(`${failed}:`, err);
      app.notify(`${failed.split(" ")[0]} failed`, `${failed}: ${err}`, "error");
      throw err;
    }
  }

  async function deleteItems(items: FileActionParams[], confirm: ConfirmFn): Promise<boolean> {
    if (!items || items.length === 0) return false;
    const unique = topLevelItems(items);
    if (unique.length === 0) return false;

    if (!(await confirm(deleteConfirmation(unique)))) return false;

    const errors: string[] = [];
    let deletedCount = 0;
    for (const item of unique) {
      try {
        await client.deleteItem(item.path);
        deletedCount++;
      } catch (err) {
        console.error(`Failed to delete ${item.path}:`, err);
        errors.push(`${item.name}: ${err}`);
      }
    }

    await refreshTree();

    for (const tab of app.openFileTabs()) {
      const tabPath = normalize(tab.path);
      const isDeleted = unique.some((item) => {
        const itemPath = normalize(item.path);
        return tabPath === itemPath || tabPath.startsWith(`${itemPath}/`);
      });
      if (isDeleted) app.closeTab(tab.id);
    }

    if (errors.length === 0) {
      if (unique.length === 1) app.notify("Item Deleted", `Permanently deleted: ${unique[0].name}`, "success");
      else app.notify("Items Deleted", `Permanently deleted ${deletedCount} items`, "success");
    } else if (deletedCount > 0) {
      app.notify(
        "Delete partially completed",
        `Deleted ${deletedCount} item${deletedCount === 1 ? "" : "s"}, but failed to delete: ${errors.join("; ")}`,
        "error",
      );
    } else {
      app.notify("Delete failed", `Delete failed: ${errors.join("; ")}`, "error");
      throw new Error(errors.join("; "));
    }
    return true;
  }

  return {
    refreshTree,
    scheduleTreeRefresh,
    createFile: (parentDir: string, name: string) => create("file", parentDir, name),
    createFolder: (parentDir: string, name: string) => create("folder", parentDir, name),
    deleteItems,
    deleteItem: async (item: FileActionParams, confirm: ConfirmFn): Promise<void> => {
      await deleteItems([item], confirm);
    },
    moveItem: (src: string, dest: string) => relocate(src, dest, "Item Moved", "Move failed"),
    renameItem: (original: string, next: string) => relocate(original, next, "Rename Complete", "Rename failed"),
    async openInFinder(path: string): Promise<void> {
      try {
        await app.revealInFolder(path);
      } catch (err) {
        console.error("Failed to reveal item in finder:", err);
        app.notify("Open failed", `Failed to open item: ${err}`, "error");
        throw err;
      }
    },
  };
}

export type ExplorerService = ReturnType<typeof createExplorerService>;
