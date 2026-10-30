import { canvasClient } from "../../../client";
/**
 * File Actions — thin stateless wrappers around individual Tauri VFS file commands.
 *
 * These are the ONLY functions in the frontend codebase allowed to call
 * `invoke` with VFS file operation command names (read_file_vfs, write_file_vfs, remove_file_vfs).
 *
 * Each function performs exactly one Tauri invocation — no orchestration or composition.
 */


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
  return canvasClient.readVfsFile(path, tabId);
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
  await canvasClient.writeVfsFile(path, content, tabId, nodeId);
}

/**
 * Remove a single file from the in-memory VFS cache.
 * Does NOT delete the file from physical disk.
 *
 * @param tabId - The canvas tab this VFS belongs to
 * @param path  - Absolute path of the file to remove
 */
export async function removeFile(tabId: string, path: string): Promise<void> {
  await canvasClient.removeVfsFile(path, tabId);
}
