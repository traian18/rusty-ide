/**
 * Tracker Actions — thin stateless wrappers around Tauri VFS tracker commands.
 *
 * The tracker maintains the mapping of nodeId → file paths[].
 * These actions handle bulk export/import of that mapping for serialization.
 */

import { invoke } from "@tauri-apps/api/core";

/**
 * Export the node→files tracker for a tab.
 * Returns a map of nodeId → array of file paths that node has written.
 *
 * @param tabId - The canvas tab to export from
 * @returns Map of nodeId → file paths
 */
export async function exportTracker(tabId: string): Promise<Record<string, string[]>> {
  return invoke<Record<string, string[]>>("export_vfs_tracker", { tabId });
}

/**
 * Import a node→files tracker map into a tab.
 * Merges the provided tracker data into the tab's existing tracker
 * (overwrites entries for the same nodeId).
 *
 * @param tabId   - The canvas tab to import into
 * @param tracker - Map of nodeId → file paths to import
 */
export async function importTracker(
  tabId: string,
  tracker: Record<string, string[]>
): Promise<void> {
  await invoke("import_vfs_tracker", { tracker, tabId });
}
