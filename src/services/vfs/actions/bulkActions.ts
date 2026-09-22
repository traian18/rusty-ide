/**
 * Bulk Actions — thin stateless wrappers around Tauri VFS bulk content commands.
 *
 * These handle exporting/importing the full in-memory file contents
 * (path → content map) for an entire tab. Used for serialization and restoration.
 */

import { invoke } from "@tauri-apps/api/core";

/**
 * Export all in-memory VFS file contents for a tab.
 * Returns a map of file path → file content for every file in the VFS cache.
 *
 * @param tabId - The canvas tab to export from
 * @returns Map of path → content
 */
export async function exportContents(tabId: string): Promise<Record<string, string>> {
  return invoke<Record<string, string>>("export_vfs_contents", { tabId });
}

/**
 * Import file contents into a tab's in-memory VFS cache.
 * Merges the provided files into the tab's existing VFS
 * (overwrites entries for the same path).
 *
 * @param tabId - The canvas tab to import into
 * @param files - Map of path → content to import
 */
export async function importContents(
  tabId: string,
  files: Record<string, string>
): Promise<void> {
  await invoke("import_vfs_contents", { files, tabId });
}
