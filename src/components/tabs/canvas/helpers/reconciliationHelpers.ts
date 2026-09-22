/**
 * reconciliationHelpers.ts
 *
 * Pure business logic for reconciling and applying VFS changes from
 * TaskNode execution outputs to the physical file system.
 *
 * These functions encapsulate the "Apply Rusty" pipeline steps without
 * depending on React state or store instances directly.
 */

import { VfsRegistry } from "../../../../services/vfs";
import { reconciliationService } from "../../../../services/reconciliationService";
import { buildReconciliationTaskFileRecords } from "../../../../services/reconciliationPaths";
import { queryDuplicateTrackedFiles } from "../../../../services/vfs/orchestrators/queryOrchestrator";

/** A minimal representation of a task node for reconciliation purposes. */
export interface TaskNodeRecord {
  id: string;
  modifiedFiles: string[];
  generatedFileContents: Record<string, string>;
}

/** The snapshot of the reconciliation state stored on the canvas context. */
export interface ReconciliationSnapshot {
  files: string[];
  ledger?: Record<string, { status: string; sourceSignature: string }>;
  generatedFileContents?: Record<string, string>;
}

/**
 * Result returned by reconcileAndApplyChanges.
 */
export interface ApplyChangesResult {
  success: boolean;
  message: string;
  notificationType: "info" | "success" | "error";
}

/**
 * Orchestrates the full "Apply Rusty" flow:
 *
 * 1. Checks that reconciliation is not running.
 * 2. Queries the reconciliation service for currently tracked files.
 * 3. Identifies collision files (tracked by multiple task nodes) and
 *    ordinary (exclusive) files.
 * 4. Removes obsolete owner entries from the ledger.
 * 5. Validates that all collision files have been fully reconciled.
 * 6. Writes reconciled / ordinary file contents to VFS.
 * 7. Flushes the VFS to disk.
 *
 * @returns Summary result for the caller to display via notification.
 */
export async function reconcileAndApplyChanges(
  tabId: string,
  rootPath: string,
  isReconciliationRunning: boolean,
  reconciliationSnapshot: ReconciliationSnapshot | undefined,
  taskNodes: TaskNodeRecord[]
): Promise<ApplyChangesResult> {
  // Step 1: Guard against concurrent reconciliation
  if (isReconciliationRunning) {
    return {
      success: false,
      message: "Wait for reconciliation to finish or stop it before applying Rusty.",
      notificationType: "info",
    };
  }

  // Step 2: Query reconciliation service for tracked files
  const reconciledFiles = await reconciliationService.getFiles(tabId);

  // Step 3: Identify collision files
  const duplicateFiles = await queryDuplicateTrackedFiles(tabId, rootPath);
  const collisionFiles = Object.keys(duplicateFiles);
  const collisionSet = new Set(collisionFiles);

  // Step 4: Remove obsolete owner entries
  const obsoleteOwnerFiles = reconciledFiles.filter((filePath) => !collisionSet.has(filePath));
  if (obsoleteOwnerFiles.length > 0) {
    await reconciliationService.removeFiles(tabId, obsoleteOwnerFiles);
  }

  // Step 5: Build task file records for active reconciled files
  const activeReconciledFiles = reconciledFiles.filter((filePath) => collisionSet.has(filePath));
  const taskFileRecords = buildReconciliationTaskFileRecords(rootPath, taskNodes, activeReconciledFiles);
  const taskOwnedFiles = Object.keys(taskFileRecords);

  if (taskOwnedFiles.length === 0) {
    return {
      success: false,
      message: "No TaskNode-owned VFS files are available.",
      notificationType: "info",
    };
  }

  // Step 6: Validate reconciliation completeness
  const ledger = reconciliationSnapshot?.ledger || {};
  const unreconciledFiles = collisionFiles.filter((filePath) => {
    const entry = ledger[filePath];
    return (
      !activeReconciledFiles.includes(filePath) ||
      entry?.status !== "reconciled" ||
      entry.sourceSignature !== taskFileRecords[filePath]?.sourceSignature
    );
  });

  if (unreconciledFiles.length > 0) {
    const verb = unreconciledFiles.length === 1 ? "still requires" : "still require";
    return {
      success: false,
      message: `${unreconciledFiles.length} overlapping file${
        unreconciledFiles.length === 1 ? "" : "s"
      } ${verb} reconciliation before Apply Rusty.`,
      notificationType: "info",
    };
  }

  // Step 7: Check that reconciliation-owned files haven't changed since last reconcile
  const vfs = VfsRegistry.getOrCreate(tabId);
  const staleFiles: string[] = [];
  for (const filePath of collisionFiles) {
    const currentContent = await vfs.readFile(filePath);
    if (currentContent !== reconciliationSnapshot?.generatedFileContents?.[filePath]) {
      staleFiles.push(filePath);
    }
  }

  if (staleFiles.length > 0) {
    const verb = staleFiles.length === 1 ? "has" : "have";
    return {
      success: false,
      message: `${staleFiles.length} reconciliation-owned file${staleFiles.length === 1 ? "" : "s"} ${verb} changed since the last reconciliation. Reconcile again before applying.`,
      notificationType: "info",
    };
  }

  // Step 8: Apply ordinary (non-collision) changed files
  const ordinaryChangedFiles = taskOwnedFiles.filter((filePath) => !collisionSet.has(filePath));
  for (const filePath of ordinaryChangedFiles) {
    const record = taskFileRecords[filePath];
    const sourcePath = record?.sourcePath || filePath;
    const taskContent = record?.taskContent ?? (await vfs.readFile(sourcePath));

    let currentContent: string | undefined;
    try {
      currentContent = await vfs.readFile(filePath);
    } catch {
      currentContent = undefined;
    }

    if (sourcePath !== filePath || currentContent !== taskContent) {
      await vfs.writeFile(filePath, taskContent);
    }
  }

  // Step 9: Apply all files to disk
  const applyFiles = Array.from(new Set([...collisionFiles, ...ordinaryChangedFiles]));
  await vfs.applyToDisk(applyFiles);

  const collisionCount = collisionFiles.length;
  const ordinaryCount = ordinaryChangedFiles.length;

  return {
    success: true,
    message: `Applied ${collisionCount} reconciled collision file${collisionCount === 1 ? "" : "s"} and ${ordinaryCount} ordinary changed file${ordinaryCount === 1 ? "" : "s"}.`,
    notificationType: "success",
  };
}
