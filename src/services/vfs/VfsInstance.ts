/**
 * VfsInstance — an independent Virtual File System scoped to a single canvas tab.
 *
 * Each tab creates its own VfsInstance. Instances are fully isolated —
 * operations on one instance have zero side-effects on others.
 * This is analogous to creating a new object in Java: each instance
 * holds its own tabId and routes all operations through it.
 *
 * Consumers should never call Tauri commands directly.
 * Instead, obtain a VfsInstance from VfsRegistry and call methods on it.
 *
 * Methods are organized into:
 *   - File Operations:  read, write, remove individual files
 *   - Node Operations:  manage files grouped by node ownership
 *   - Query Operations: filter and search across tracked files
 *   - Lifecycle:        apply selected files to disk, snapshot/restore for persistence
 *   - Execution:        pre/post execution setup and cleanup
 */

import type { NodeFilesEntry, VfsSnapshot, VfsFileQuery } from "./types";
import * as fileActions from "./actions/fileActions";
import * as nodeActions from "./actions/nodeActions";
import * as trackerActions from "./actions/trackerActions";
import * as bulkActions from "./actions/bulkActions";
import * as lifecycleActions from "./actions/lifecycleActions";

export const VFS_CHANGED_EVENT = "rusty-vfs-changed";

export interface VfsChangedDetail {
  tabId: string;
  nodeId?: string;
  paths?: string[];
  operation?: "write" | "remove" | "set-tracker" | "delete-node" | "restore";
}

function notifyVfsChanged(detail: VfsChangedDetail): void {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(VFS_CHANGED_EVENT, { detail }));
  }
}

export class VfsInstance {
  /** The canvas tab ID this instance is scoped to. Immutable after construction. */
  public readonly tabId: string;

  constructor(tabId: string) {
    this.tabId = tabId;
  }

  // ─── File Operations ─────────────────────────────────────────────────────────

  /**
   * Read a single file from this tab's VFS.
   * Checks the in-memory cache first; falls back to physical disk.
   */
  async readFile(path: string): Promise<string> {
    return fileActions.readFile(this.tabId, path);
  }

  /**
   * Write a file into this tab's in-memory VFS cache.
   * If nodeId is provided, the file is tracked as belonging to that node.
   */
  async writeFile(path: string, content: string, nodeId?: string): Promise<void> {
    await fileActions.writeFile(this.tabId, path, content, nodeId);
    notifyVfsChanged({ tabId: this.tabId, nodeId, paths: [path], operation: "write" });
  }

  /**
   * Remove a single file from this tab's VFS cache.
   * Does NOT delete the file from physical disk.
   */
  async removeFile(path: string): Promise<void> {
    await fileActions.removeFile(this.tabId, path);
    notifyVfsChanged({ tabId: this.tabId, paths: [path], operation: "remove" });
  }

  // ─── Node Operations ─────────────────────────────────────────────────────────

  /**
   * Get the list of file paths tracked to a specific node.
   * Returns an empty array if the node has no tracked files.
   */
  async getNodeFiles(nodeId: string): Promise<string[]> {
    const allEntries = await nodeActions.getTrackedNodeFiles(this.tabId);
    const entry = allEntries.find((e) => e.node_id === nodeId);
    return entry ? entry.files : [];
  }

  /**
   * Get all node→files associations for this tab's VFS.
   */
  async getAllNodeFiles(): Promise<NodeFilesEntry[]> {
    return nodeActions.getTrackedNodeFiles(this.tabId);
  }

  /**
   * Delete all VFS files tracked to a specific node.
   * Clears the node's tracker entry and removes cache content only when no
   * other TaskNode or reconciliation owner still references that path.
   */
  async deleteNodeFiles(nodeId: string): Promise<void> {
    const paths = await this.getNodeFiles(nodeId);
    await nodeActions.deleteNodeFiles(this.tabId, nodeId);
    notifyVfsChanged({ tabId: this.tabId, nodeId, paths, operation: "delete-node" });
  }

  /** Delete one file from this node's tracker and this tab's VFS. */
  async deleteNodeFile(nodeId: string, path: string): Promise<void> {
    await nodeActions.deleteNodeFile(this.tabId, nodeId, path);
    notifyVfsChanged({ tabId: this.tabId, nodeId, paths: [path], operation: "remove" });
  }

  /**
   * Delete all VFS files across all nodes in this tab.
   */
  async deleteAllFiles(): Promise<void> {
    const allEntries = await this.getAllNodeFiles();
    for (const entry of allEntries) {
      await nodeActions.deleteNodeFiles(this.tabId, entry.node_id);
    }
  }

  /**
   * Overwrite the tracker entry for a single node with a new file list.
   * Used after execution completes to reconcile tracked files.
   */
  async setNodeTrackedFiles(nodeId: string, files: string[]): Promise<void> {
    await trackerActions.importTracker(this.tabId, { [nodeId]: files });
    notifyVfsChanged({ tabId: this.tabId, nodeId, paths: files, operation: "set-tracker" });
  }

  // ─── Query Operations ────────────────────────────────────────────────────────

  /**
   * Query tracked files with flexible filtering.
   * All filters are optional and combined with AND logic.
   *
   * @returns Filtered NodeFilesEntry[] — only entries and files matching all filters
   */
  async queryFiles(query: VfsFileQuery): Promise<NodeFilesEntry[]> {
    let entries = await this.getAllNodeFiles();

    // Filter by nodeId
    if (query.nodeId) {
      entries = entries.filter((e) => e.node_id === query.nodeId);
    }

    // Filter individual files within each entry
    if (query.pathPrefix || query.pathPattern || query.extension) {
      entries = entries
        .map((entry) => ({
          ...entry,
          files: entry.files.filter((filePath) => {
            if (query.pathPrefix && !filePath.startsWith(query.pathPrefix)) {
              return false;
            }
            if (query.pathPattern && !query.pathPattern.test(filePath)) {
              return false;
            }
            if (query.extension && !filePath.endsWith(query.extension)) {
              return false;
            }
            return true;
          }),
        }))
        .filter((entry) => entry.files.length > 0);
    }

    return entries;
  }

  /**
   * Get all tracked file paths that match a given file extension.
   */
  async getFilesByExtension(ext: string): Promise<string[]> {
    const entries = await this.queryFiles({ extension: ext });
    return entries.flatMap((e) => e.files);
  }

  /**
   * Get all tracked file paths that start with the given directory prefix.
   */
  async getFilesByPathPrefix(prefix: string): Promise<string[]> {
    const entries = await this.queryFiles({ pathPrefix: prefix });
    return entries.flatMap((e) => e.files);
  }

  // ─── Lifecycle ────────────────────────────────────────────────────────────────

  /** Apply selected VFS paths to disk without clearing contents or ownership. */
  async applyToDisk(paths: string[]): Promise<void> {
    return lifecycleActions.applyToDisk(this.tabId, paths);
  }

  /**
   * Create a serializable snapshot of this tab's full VFS state.
   * Used for persisting VFS state when saving a canvas to disk.
   */
  async snapshot(): Promise<VfsSnapshot> {
    const [contents, tracker] = await Promise.all([
      bulkActions.exportContents(this.tabId),
      trackerActions.exportTracker(this.tabId),
    ]);
    return { contents, tracker };
  }

  /**
   * Restore VFS state from a previously captured snapshot.
   * Used when reopening a saved canvas from a JSON file.
   */
  async restore(snap: VfsSnapshot): Promise<void> {
    const hasContents = snap.contents && Object.keys(snap.contents).length > 0;
    const hasTracker = snap.tracker && Object.keys(snap.tracker).length > 0;

    if (hasContents) {
      await bulkActions.importContents(this.tabId, snap.contents);
    }
    if (hasTracker) {
      await trackerActions.importTracker(this.tabId, snap.tracker);
    }
    notifyVfsChanged({
      tabId: this.tabId,
      paths: Object.keys(snap.contents || {}),
      operation: "restore",
    });
  }

  // ─── Execution Helpers ────────────────────────────────────────────────────────

  /**
   * Prepare the VFS for a node execution.
   * Queries the current tracked files for the node, clears them,
   * and returns the list of files that existed before clearing
   * (used later to detect and clean stale files).
   *
   * @param nodeId - The node about to execute
   * @returns The list of file paths that were tracked before clearing
   */
  async prepareForExecution(nodeId: string): Promise<string[]> {
    const initialFiles = await this.getNodeFiles(nodeId);
    await this.deleteNodeFiles(nodeId);
    return initialFiles;
  }

  /**
   * Finalize the VFS after a node execution completes.
   * Overwrites the node's tracker with the new file list, and removes
   * any stale files that were in the initial set but not in the new set.
   *
   * @param nodeId        - The node that just finished executing
   * @param modifiedFiles - The files produced by this execution
   * @param initialFiles  - The files that existed before execution (from prepareForExecution)
   */
  async finalizeExecution(
    nodeId: string,
    modifiedFiles: string[],
    _initialFiles: string[]
  ): Promise<void> {
    // Overwrite the tracker with the final file list
    await this.setNodeTrackedFiles(nodeId, modifiedFiles);
    // prepareForExecution already removed this node's previous ownership using
    // reference-aware node deletion. Never remove stale paths directly here:
    // another TaskNode may still own their shared VFS content.
  }
}
