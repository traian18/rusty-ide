/**
 * Node Actions — thin stateless wrappers around Tauri VFS node-level commands.
 *
 * These handle operations scoped to a specific node within a tab's VFS:
 * deleting a node's file ownership, and querying the node→files mapping.
 */

import { invoke } from "@tauri-apps/api/core";
import type { NodeFilesEntry } from "../types";

/**
 * Delete all VFS files tracked to a specific node.
 * Clears the node's tracker entry. Shared VFS content remains while another
 * node still owns the same path.
 *
 * @param tabId  - The canvas tab this VFS belongs to
 * @param nodeId - The node whose files should be deleted
 */
export async function deleteNodeFiles(tabId: string, nodeId: string): Promise<void> {
  await invoke("delete_node_vfs_files", { nodeId, tabId });
}

/** Delete one tracked file for a node without disturbing another node's ownership. */
export async function deleteNodeFile(
  tabId: string,
  nodeId: string,
  path: string
): Promise<void> {
  await invoke("delete_node_vfs_file", { nodeId, path, tabId });
}

/**
 * Get all node→files associations for a tab.
 * Returns an array where each entry contains a nodeId and its tracked file paths.
 *
 * @param tabId - The canvas tab to query
 * @returns Array of { node_id, files } entries
 */
export async function getTrackedNodeFiles(tabId: string): Promise<NodeFilesEntry[]> {
  return invoke<NodeFilesEntry[]>("get_all_node_vfs_files", { tabId });
}
