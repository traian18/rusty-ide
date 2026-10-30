/**
 * Persistence Orchestrator — coordinates save/restore of VFS state to/from canvas JSON.
 *
 * Handles the multi-step flows for:
 * - Capturing a VfsSnapshot when saving a canvas (export contents + tracker, filter to existing nodes)
 * - Restoring a VfsSnapshot when reopening a saved canvas (import contents + tracker)
 *
 * Functions here are orchestrators: they coordinate multiple actions
 * but do not call Tauri directly.
 */

import type { VfsSnapshot } from "../types";
import { VfsRegistry } from "../VfsRegistry";

/**
 * Capture a VfsSnapshot for saving a canvas to disk.
 *
 * 1. Exports the full VFS contents (path → content)
 * 2. Exports the tracker (nodeId → files)
 * 3. Filters the tracker to only include nodes present in nodeIds
 *
 * @param tabId   - The canvas tab to capture
 * @param nodeIds - Set of node IDs that exist in the canvas (for filtering stale tracker entries)
 * @returns A VfsSnapshot ready for JSON serialization
 */
export async function captureVfsForSave(
  tabId: string,
  nodeIds: Set<string>
): Promise<VfsSnapshot> {
  const vfs = VfsRegistry.getOrCreate(tabId);
  const snap = await vfs.snapshot();

  // Filter tracker to only include nodes that exist in the canvas
  const filteredTracker: Record<string, string[]> = {};
  for (const nodeId of Object.keys(snap.tracker)) {
    if (nodeIds.has(nodeId)) {
      filteredTracker[nodeId] = snap.tracker[nodeId];
    }
  }

  return {
    contents: snap.contents,
    tracker: filteredTracker,
  };
}

/**
 * Restore VFS state from a saved canvas JSON file.
 *
 * 1. Creates or retrieves a VfsInstance for the tab
 * 2. Imports the file contents into VFS memory
 * 3. Imports the node→files tracker
 *
 * @param tabId    - The canvas tab to restore into
 * @param snapshot - The VfsSnapshot read from the saved JSON
 */
export async function restoreVfsFromSave(
  tabId: string,
  snapshot: VfsSnapshot
): Promise<void> {
  const vfs = VfsRegistry.getOrCreate(tabId);
  await vfs.restore(snapshot);
  console.log(
    `[persistenceOrchestrator] Restored VFS for tab ${tabId}: ` +
    `${Object.keys(snapshot.contents).length} files, ` +
    `${Object.keys(snapshot.tracker).length} tracked nodes`
  );
}
