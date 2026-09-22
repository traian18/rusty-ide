/**
 * Query Orchestrator — composite query capabilities on top of VFS tracker data.
 *
 * Provides higher-level query methods that compose VfsInstance primitives.
 * These are convenience orchestrators for common query patterns.
 *
 * Functions here are orchestrators: they coordinate multiple actions
 * but do not call Tauri directly.
 */

import type { NodeFilesEntry, VfsFileQuery } from "../types";
import { VfsRegistry } from "../VfsRegistry";
import { RECONCILIATION_NODE_PREFIX } from "../../reconciliationService";
import { normalizeReconciliationPath } from "../../reconciliationPaths";

/**
 * Get all file paths tracked to a specific node.
 *
 * @param tabId  - The canvas tab
 * @param nodeId - The node to query
 * @returns Array of file paths owned by the node
 */
export async function queryFilesByNode(
  tabId: string,
  nodeId: string
): Promise<string[]> {
  const vfs = VfsRegistry.getOrCreate(tabId);
  return vfs.getNodeFiles(nodeId);
}

/**
 * Get all tracked file paths matching a file extension.
 *
 * @param tabId - The canvas tab
 * @param ext   - File extension to match (e.g. ".ts", ".tsx")
 * @returns Array of matching file paths across all nodes
 */
export async function queryFilesByExtension(
  tabId: string,
  ext: string
): Promise<string[]> {
  const vfs = VfsRegistry.getOrCreate(tabId);
  return vfs.getFilesByExtension(ext);
}

/**
 * Get all tracked file paths under a directory prefix.
 *
 * @param tabId  - The canvas tab
 * @param prefix - Directory path prefix to match
 * @returns Array of matching file paths across all nodes
 */
export async function queryFilesByPathPrefix(
  tabId: string,
  prefix: string
): Promise<string[]> {
  const vfs = VfsRegistry.getOrCreate(tabId);
  return vfs.getFilesByPathPrefix(prefix);
}

/**
 * General query with multiple optional filters (AND logic).
 *
 * @param tabId - The canvas tab
 * @param query - Query filters (nodeId, pathPrefix, pathPattern, extension)
 * @returns Filtered NodeFilesEntry[] matching all provided filters
 */
export async function queryFiles(
  tabId: string,
  query: VfsFileQuery
): Promise<NodeFilesEntry[]> {
  const vfs = VfsRegistry.getOrCreate(tabId);
  return vfs.queryFiles(query);
}

/**
 * Fetch all tracked file paths in VFS and return those that are modified by more than one task node.
 * 
 * @param tabId - The canvas tab
 * @returns Record of duplicate file paths mapped to array of task node IDs that modified them
 */
export async function queryDuplicateTrackedFiles(
  tabId: string,
  workspaceRoot?: string,
): Promise<Record<string, string[]>> {
  const vfs = VfsRegistry.getOrCreate(tabId);
  const nodeFiles = await vfs.getAllNodeFiles();

  const fileToNodesMap: Record<string, string[]> = {};
  for (const entry of nodeFiles) {
    // The finalized reconciliation result is a synthetic VFS owner, not a new
    // source-task collision.
    if (entry.node_id.startsWith(RECONCILIATION_NODE_PREFIX)) continue;
    for (const filePath of entry.files) {
      let workspacePath = filePath;
      if (workspaceRoot) {
        try {
          workspacePath = normalizeReconciliationPath(workspaceRoot, filePath);
        } catch {
          // Keep invalid paths visible so reconciliation can report them rather
          // than silently hiding a task-owned VFS entry.
        }
      }
      if (!fileToNodesMap[workspacePath]) {
        fileToNodesMap[workspacePath] = [];
      }
      if (!fileToNodesMap[workspacePath].includes(entry.node_id)) {
        fileToNodesMap[workspacePath].push(entry.node_id);
      }
    }
  }

  const duplicates: Record<string, string[]> = {};
  for (const [filePath, nodes] of Object.entries(fileToNodesMap)) {
    if (nodes.length > 1) {
      duplicates[filePath] = nodes;
    }
  }

  return duplicates;
}
