import { VfsRegistry } from "./vfs/VfsRegistry";
import type { ReconciliationSnapshot } from "../store/types";

export const RECONCILIATION_NODE_PREFIX = "__reconciliation_node__:";

export function withoutReconciliationFiles(
  snapshot: ReconciliationSnapshot | undefined,
  filePaths: string[],
  options?: { preserveOriginal?: boolean },
): ReconciliationSnapshot | undefined {
  if (!snapshot) return undefined;
  const removed = new Set(filePaths);
  const ledger = { ...(snapshot.ledger || {}) };
  const originalFileContents = { ...snapshot.originalFileContents };
  const generatedFileContents = { ...snapshot.generatedFileContents };
  for (const filePath of removed) {
    delete ledger[filePath];
    if (!options?.preserveOriginal) delete originalFileContents[filePath];
    delete generatedFileContents[filePath];
  }
  return {
    ...snapshot,
    files: snapshot.files.filter((filePath) => !removed.has(filePath)),
    ledger,
    originalFileContents,
    generatedFileContents,
    updatedAt: new Date().toISOString(),
  };
}

/** Reconciliation behaves like a synthetic TaskNode inside the canvas VFS. */
export const reconciliationService = {
  getNodeId: (tabId: string) => `${RECONCILIATION_NODE_PREFIX}${tabId}`,

  getFiles: (tabId: string): Promise<string[]> => {
    return VfsRegistry.getOrCreate(tabId).getNodeFiles(reconciliationService.getNodeId(tabId));
  },

  setFiles: (tabId: string, filePaths: string[]): Promise<void> => {
    return VfsRegistry.getOrCreate(tabId).setNodeTrackedFiles(
      reconciliationService.getNodeId(tabId),
      Array.from(new Set(filePaths)),
    );
  },

  removeFiles: async (tabId: string, filePaths: string[]): Promise<void> => {
    const vfs = VfsRegistry.getOrCreate(tabId);
    const nodeId = reconciliationService.getNodeId(tabId);
    for (const filePath of new Set(filePaths)) {
      await vfs.deleteNodeFile(nodeId, filePath);
    }
  },
};
