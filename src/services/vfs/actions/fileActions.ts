/**
 * File Actions — thin stateless wrappers around individual Tauri VFS file commands.
 *
 * These are the ONLY functions in the frontend codebase allowed to call
 * `invoke` with VFS file operation command names (read_file_vfs, write_file_vfs, remove_file_vfs).
 *
 * Each function performs exactly one Tauri invocation — no orchestration or composition.
 */

import { invoke } from "@tauri-apps/api/core";

/**
 * Read a single file from the VFS.
 * Checks the in-memory VFS cache first; falls back to physical disk if not found.
 *
 * @param tabId - The canvas tab this VFS belongs to
 * @param path  - Absolute path to the file
 * @returns The file content as a string
 * @throws If the file is not found in VFS or on disk
 */
export async function readFile(tabId: string, path: string): Promise<string> {
  return invoke<string>("read_file_vfs", { path, tabId });
}

/**
 * Write a file into the in-memory VFS cache.
 * The file is NOT written to disk — it remains in memory until Apply Rusty.
 * If a nodeId is provided, the file is tracked as belonging to that node.
 *
 * @param tabId   - The canvas tab this VFS belongs to
 * @param path    - Absolute path for the file
 * @param content - The full file content to write
 * @param nodeId  - Optional node that owns this file (for tracking)
 */
export async function writeFile(
  tabId: string,
  path: string,
  content: string,
  nodeId?: string
): Promise<void> {
  await invoke("write_file_vfs", {
    path,
    content,
    nodeId: nodeId || null,
    tabId,
  });
}

/**
 * Remove a single file from the in-memory VFS cache.
 * Does NOT delete the file from physical disk.
 *
 * @param tabId - The canvas tab this VFS belongs to
 * @param path  - Absolute path of the file to remove
 */
export async function removeFile(tabId: string, path: string): Promise<void> {
  await invoke("remove_file_vfs", { path, tabId });
}
