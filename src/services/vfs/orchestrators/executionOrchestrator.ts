/**
 * Execution Orchestrator — coordinates VFS state around node execution.
 *
 * This orchestrator extracts the pre-execution setup and post-execution cleanup
 * logic that was previously inlined in Workspace.tsx. It composes VfsInstance
 * methods into coherent multi-step flows.
 *
 * Functions here are orchestrators: they coordinate multiple actions
 * but do not call Tauri directly.
 */

import { VfsRegistry } from "../VfsRegistry";

/**
 * Prepare the VFS for a node execution.
 *
 * 1. Ensures a VfsInstance exists for the tab
 * 2. Queries the current tracked files for the node
 * 3. Clears the node's files from the VFS
 * 4. Returns the list of files that existed before clearing
 *
 * The returned file list is used later by finalizeNodeExecution to
 * detect and clean up stale files.
 *
 * @param tabId  - The canvas tab the node belongs to
 * @param nodeId - The node about to execute
 * @returns The list of file paths tracked before clearing
 */
export async function prepareNodeExecution(
  tabId: string | undefined,
  nodeId: string
): Promise<string[]> {
  const vfs = VfsRegistry.getOrCreate(tabId);
  return vfs.prepareForExecution(nodeId);
}

/**
 * Finalize the VFS after a node execution completes.
 *
 * 1. Overwrites the node's tracker with the new file list
 * 2. Removes stale files (in initial set but not in new set) from VFS
 *
 * @param tabId         - The canvas tab the node belongs to
 * @param nodeId        - The node that just finished executing
 * @param modifiedFiles - The files produced by this execution
 * @param initialFiles  - The files that existed before execution (from prepareNodeExecution)
 */
export async function finalizeNodeExecution(
  tabId: string | undefined,
  nodeId: string,
  modifiedFiles: string[],
  initialFiles: string[]
): Promise<void> {
  const vfs = VfsRegistry.getOrCreate(tabId);
  return vfs.finalizeExecution(nodeId, modifiedFiles, initialFiles);
}
