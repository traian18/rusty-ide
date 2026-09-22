import { invoke } from "@tauri-apps/api/core";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { useWorkspaceStore } from "../../store";
import { fileTabIdentity } from "../../tabs/identity";
import { notify } from "../../notificationStore";
import { FileTreeActions, FileActionParams } from "./FileTreeActions";

let activeRefresh: Promise<void> | null = null;
let refreshRequestedWhileActive = false;
let scheduledRefresh: ReturnType<typeof setTimeout> | null = null;

async function performTreeRefresh(): Promise<void> {
  const state = useWorkspaceStore.getState();
  if (state.rootPath) {
    try {
      const tree: any[] = await invoke("get_directory_structure", { rootDir: state.rootPath });
      state.setFileTree(tree);
      await state.loadGitStatus();
    } catch (err) {
      console.error("Failed to refresh file tree structure:", err);
    }
  }
}

export async function refreshTree(): Promise<void> {
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
export function scheduleTreeRefresh(delayMs = 750): void {
  if (scheduledRefresh) clearTimeout(scheduledRefresh);
  scheduledRefresh = setTimeout(() => {
    scheduledRefresh = null;
    void refreshTree();
  }, delayMs);
}

export const fileTreePresenter: FileTreeActions = {
  async createFile(parentDir: string, name: string): Promise<void> {
    const filePath = `${parentDir}/${name}`;
    console.log(`FileTreePresenter: Creating file: ${filePath}`);
    try {
      await invoke("create_file", { path: filePath });
      await refreshTree();
      useWorkspaceStore.getState().setPathExpanded(parentDir, true);
      notify("File Created", `Successfully created file: ${name}`, "success");
    } catch (err: any) {
      console.error("Failed to create file:", err);
      notify("Create failed", `Create file failed: ${err}`, "error");
      throw err;
    }
  },

  async createFolder(parentDir: string, name: string): Promise<void> {
    const dirPath = `${parentDir}/${name}`;
    console.log(`FileTreePresenter: Creating folder: ${dirPath}`);
    try {
      await invoke("create_directory", { path: dirPath });
      await refreshTree();
      useWorkspaceStore.getState().setPathExpanded(parentDir, true);
      notify("Folder Created", `Successfully created folder: ${name}`, "success");
    } catch (err: any) {
      console.error("Failed to create folder:", err);
      notify("Create failed", `Create folder failed: ${err}`, "error");
      throw err;
    }
  },

  async deleteItems(
    items: FileActionParams[],
    confirmFn: (options: { title: string; message: string; confirmLabel: string; cancelLabel: string; kind: "danger" | "warning" }) => Promise<boolean>
  ): Promise<boolean> {
    if (!items || items.length === 0) return false;

    // Filter duplicates and remove items that are children of other directories being deleted
    const normalize = (p: string) => p.replace(/\\/g, "/");
    const uniqueItems = items.filter(
      (item, idx, self) =>
        self.findIndex((other) => other.path === item.path) === idx &&
        !self.some((other) => other.path !== item.path && normalize(item.path).startsWith(`${normalize(other.path)}/`))
    );

    if (uniqueItems.length === 0) return false;

    const isSingle = uniqueItems.length === 1;
    const title = isSingle ? "Confirm Delete" : `Confirm Delete (${uniqueItems.length} items)`;
    const message = isSingle
      ? `Are you sure you want to permanently delete "${uniqueItems[0].name}"? This action cannot be undone.`
      : `Are you sure you want to permanently delete ${uniqueItems.length} items? This action cannot be undone.`;
    const confirmLabel = isSingle ? "Delete" : `Delete ${uniqueItems.length} Items`;

    const confirmed = await confirmFn({
      title,
      message,
      confirmLabel,
      cancelLabel: "Cancel",
      kind: "danger",
    });

    if (!confirmed) {
      console.log("Delete action aborted by user.");
      return false;
    }

    const errors: string[] = [];
    let deletedCount = 0;

    for (const item of uniqueItems) {
      console.log(`FileTreePresenter: Request to delete: ${item.path}`);
      try {
        await invoke("delete_file_or_dir", { path: item.path });
        deletedCount++;
      } catch (err: any) {
        console.error(`Failed to delete ${item.path}:`, err);
        errors.push(`${item.name}: ${err}`);
      }
    }

    await refreshTree();

    const state = useWorkspaceStore.getState();
    for (const tab of state.tabs) {
      if (tab.type === "file") {
        const normTabPath = normalize(tab.path);
        const isDeleted = uniqueItems.some((item) => {
          const normItemPath = normalize(item.path);
          return normTabPath === normItemPath || normTabPath.startsWith(`${normItemPath}/`);
        });
        if (isDeleted) {
          state.closeTab(tab.id);
        }
      }
    }

    if (errors.length === 0) {
      if (isSingle) {
        notify("Item Deleted", `Permanently deleted: ${uniqueItems[0].name}`, "success");
      } else {
        notify("Items Deleted", `Permanently deleted ${deletedCount} items`, "success");
      }
    } else {
      if (deletedCount > 0) {
        notify(
          "Delete partially completed",
          `Deleted ${deletedCount} item${deletedCount === 1 ? "" : "s"}, but failed to delete: ${errors.join("; ")}`,
          "error"
        );
      } else {
        notify("Delete failed", `Delete failed: ${errors.join("; ")}`, "error");
        throw new Error(errors.join("; "));
      }
    }

    return true;
  },

  async deleteItem(
    item: FileActionParams,
    confirmFn: (options: { title: string; message: string; confirmLabel: string; cancelLabel: string; kind: "danger" | "warning" }) => Promise<boolean>
  ): Promise<void> {
    await this.deleteItems([item], confirmFn);
  },

  async moveItem(srcPath: string, destPath: string): Promise<void> {
    console.log(`FileTreePresenter: Moving item from ${srcPath} to ${destPath}`);
    if (srcPath === destPath) return;

    try {
      await invoke("move_file_or_dir", { src: srcPath, dest: destPath });
      await refreshTree();

      const state = useWorkspaceStore.getState();
      const tabId = fileTabIdentity(srcPath);
      state.closeTab(tabId);
      
      // Track for undo capability
      state.setLastRename({ originalPath: srcPath, newPath: destPath });
      notify("Item Moved", `Moved to: ${destPath.split("/").pop()}`, "success");
    } catch (err: any) {
      console.error("Failed to move item:", err);
      notify("Move failed", `Move failed: ${err}`, "error");
      throw err;
    }
  },

  async renameItem(originalPath: string, newPath: string): Promise<void> {
    console.log(`FileTreePresenter: Renaming from ${originalPath} to ${newPath}`);
    if (originalPath === newPath) return;

    try {
      await invoke("move_file_or_dir", { src: originalPath, dest: newPath });
      await refreshTree();

      const state = useWorkspaceStore.getState();
      const tabId = fileTabIdentity(originalPath);
      state.closeTab(tabId);

      state.setLastRename({ originalPath, newPath });
      notify("Rename Complete", `Renamed to: ${newPath.split("/").pop()}`, "success");
    } catch (err: any) {
      console.error("Failed to rename item:", err);
      notify("Rename failed", `Rename failed: ${err}`, "error");
      throw err;
    }
  },

  async openInFinder(path: string): Promise<void> {
    console.log(`FileTreePresenter: Opening in native explorer: ${path}`);
    try {
      await revealItemInDir(path);
    } catch (err: any) {
      console.error("Failed to reveal item in finder:", err);
      notify("Open failed", `Failed to open item: ${err}`, "error");
      throw err;
    }
  },
};
