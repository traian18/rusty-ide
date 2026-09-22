/**
 * Lifecycle Actions — thin stateless wrappers around Tauri VFS lifecycle commands.
 *
 * These handle applying VFS contents to the physical disk and managing
 * the global "currently executing node" state.
 */

import { invoke } from "@tauri-apps/api/core";

/**
 * Apply selected reconciliation-owned VFS files to the physical disk.
 * Each selected file is written to its path on disk, creating parent
 * directories as needed. VFS contents and ownership remain intact so the user
 * can inspect, edit, Git-rollback the disk, and apply again.
 *
 * @param tabId - The canvas tab whose VFS should be applied
 * @param paths - Exact reconciliation-owned paths to apply
 */
export async function applyToDisk(tabId: string, paths: string[]): Promise<void> {
  await invoke("apply_vfs_to_disk", { tabId, paths });
}

/**
 * Set which node is currently executing.
 * This is a global (non-tab-scoped) state used by the Rust backend
 * to route file operations to the correct node tracker.
 *
 * @param nodeId - The node ID to mark as executing, or null to clear
 */
export async function setExecutingNode(nodeId: string | null): Promise<void> {
  await invoke("set_current_executing_node", { nodeId });
}
