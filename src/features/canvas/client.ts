/** Every command the canvas calls: file access, the per-tab virtual file system (VFS), and the executing node. */
import { invoke } from "@tauri-apps/api/core";

/** Calls a Tauri command by name. The app passes the real bridge; tests pass a fake one. */
export type Invoke = <T>(command: string, args: Record<string, unknown>) => Promise<T>;

import type { NodeFilesEntry } from "./service/vfs/types";

export type { NodeFilesEntry };

export interface CanvasClient {
  readFile(path: string): Promise<string>;
  /** Writes a disk file; `tabId` is passed along when the write belongs to a canvas tab. */
  writeFile(path: string, content: string, tabId?: string): Promise<void>;
  readVfsFile(path: string, tabId: string): Promise<string>;
  writeVfsFile(path: string, content: string, tabId: string, nodeId?: string): Promise<void>;
  removeVfsFile(path: string, tabId: string): Promise<void>;
  exportVfsContents(tabId: string): Promise<Record<string, string>>;
  importVfsContents(files: Record<string, string>, tabId: string): Promise<void>;
  exportVfsTracker(tabId: string): Promise<Record<string, string[]>>;
  importVfsTracker(tracker: Record<string, string[]>, tabId: string): Promise<void>;
  nodeVfsFiles(tabId: string): Promise<NodeFilesEntry[]>;
  deleteNodeVfsFiles(nodeId: string, tabId: string): Promise<void>;
  deleteNodeVfsFile(nodeId: string, path: string, tabId: string): Promise<void>;
  applyVfsToDisk(tabId: string, paths: string[]): Promise<void>;
  setCurrentExecutingNode(nodeId: string | null): Promise<void>;
}

/** Builds the canvas client on a command bridge. Each method names one Tauri command and its arguments. */
export function createCanvasClient(call: Invoke): CanvasClient {
  return {
    readFile: (path) => call("read_file_disk", { path }),
    writeFile: (path, content, tabId) => call("write_file_disk", tabId === undefined ? { path, content } : { path, content, tabId }),
    readVfsFile: (path, tabId) => call("read_file_vfs", { path, tabId }),
    writeVfsFile: (path, content, tabId, nodeId) => call("write_file_vfs", { path, content, nodeId: nodeId || null, tabId }),
    removeVfsFile: (path, tabId) => call("remove_file_vfs", { path, tabId }),
    exportVfsContents: (tabId) => call("export_vfs_contents", { tabId }),
    importVfsContents: (files, tabId) => call("import_vfs_contents", { files, tabId }),
    exportVfsTracker: (tabId) => call("export_vfs_tracker", { tabId }),
    importVfsTracker: (tracker, tabId) => call("import_vfs_tracker", { tracker, tabId }),
    nodeVfsFiles: (tabId) => call("get_all_node_vfs_files", { tabId }),
    deleteNodeVfsFiles: (nodeId, tabId) => call("delete_node_vfs_files", { nodeId, tabId }),
    deleteNodeVfsFile: (nodeId, path, tabId) => call("delete_node_vfs_file", { nodeId, path, tabId }),
    applyVfsToDisk: (tabId, paths) => call("apply_vfs_to_disk", { tabId, paths }),
    setCurrentExecutingNode: (nodeId) => call("set_current_executing_node", { nodeId }),
  };
}

/** The app's canvas client, backed by the Tauri bridge. */
export const canvasClient: CanvasClient = createCanvasClient(invoke);
