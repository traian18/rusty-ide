/**
 * useVfsFileSync.ts
 *
 * Synchronises the task node's file metadata (modified files list, original
 * and generated contents) with the VFS registry. This ensures that files
 * written by chat tools are reflected in the node's UI cache.
 */

import { useEffect, useRef } from "react";
import { useWorkspaceStore } from "../../../store";
import { VfsRegistry, VFS_CHANGED_EVENT } from "../../../services/vfs";

/**
 * Keeps the selected task node's `modifiedFiles`, `originalFileContents`, and
 * `generatedFileContents` in sync with the VFS registry.
 *
 * Returns `undefined` because it is a fire-and-forget side-effect; all state
 * mutations are performed directly on the workspace store.
 *
 * @param tabId          - The current canvas tab ID (may be undefined).
 * @param selectedNodeId - The selected node ID (may be null).
 * @param selectedNode   - The selected node object (may be undefined).
 */
export function useVfsFileSync(
  tabId: string | undefined,
  selectedNodeId: string | null,
  selectedNode: any
): void {
  const cancelledRef = useRef(false);

  useEffect(() => {
    if (!tabId || !selectedNodeId || selectedNode?.type !== "taskNode") return;

    cancelledRef.current = false;

    /**
     * Reads the tracked files from VFS and updates the store if they differ
     * from the node's current metadata.
     */
    const syncModifiedFiles = async (): Promise<void> => {
      try {
        const trackedFiles = await VfsRegistry.getOrCreate(tabId).getNodeFiles(
          selectedNodeId
        );
        if (cancelledRef.current) return;

        const store = useWorkspaceStore.getState();
        const latestNode = store.canvasContexts[tabId]?.nodes.find(
          (node) => node.id === selectedNodeId
        );
        if (!latestNode) return;

        const currentFiles: string[] =
          (latestNode?.data?.modifiedFiles as string[]) || [];
        const originalFileContents: Record<string, string> =
          (latestNode?.data?.originalFileContents as Record<string, string>) ||
          {};
        const generatedFileContents: Record<string, string> =
          (latestNode?.data?.generatedFileContents as Record<string, string>) ||
          {};

        const hasChanged =
          trackedFiles.length !== currentFiles.length ||
          trackedFiles.some(
            (file: string, index: number) => file !== currentFiles[index]
          );

        if (!hasChanged) return;

        store.updateTaskNode(selectedNodeId, {
          modifiedFiles: trackedFiles,
          originalFileContents: Object.fromEntries(
            trackedFiles
              .filter(
                (file: string) => originalFileContents[file] !== undefined
              )
              .map((file: string) => [file, originalFileContents[file]])
          ),
          generatedFileContents: Object.fromEntries(
            trackedFiles
              .filter(
                (file: string) => generatedFileContents[file] !== undefined
              )
              .map((file: string) => [file, generatedFileContents[file]])
          ),
        });
      } catch (err) {
        console.error(
          "[SidePane] Failed to sync task files from VFS:",
          err
        );
      }
    };

    /**
     * Handles VFS_CHANGED_EVENT and triggers a re-sync when the event
     * belongs to the current tab.
     */
    const handleVfsChanged = (event: Event): void => {
      const changedTabId = (
        event as CustomEvent<{ tabId: string }>
      ).detail?.tabId;
      if (changedTabId === tabId) {
        void syncModifiedFiles();
      }
    };

    void syncModifiedFiles();
    window.addEventListener(VFS_CHANGED_EVENT, handleVfsChanged);

    return () => {
      cancelledRef.current = true;
      window.removeEventListener(VFS_CHANGED_EVENT, handleVfsChanged);
    };
  }, [
    tabId,
    selectedNodeId,
    selectedNode?.type,
    selectedNode?.data?.modifiedFiles,
    selectedNode?.data?.originalFileContents,
    selectedNode?.data?.generatedFileContents,
  ]);
}
