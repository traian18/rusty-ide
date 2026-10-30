import { useCallback } from "react";
import type { SourceControlModel } from "./useSourceControl";
import { gitService } from "./gitService";

export function useBranchHandlers(model: SourceControlModel) {
  const {
    lastRename,
    setLastRename,
    activeRepo,
    disableBranchOnlyActions,
    setLocalBranches,
    setRemoteBranches,
    showBranchPopover,
    setShowBranchPopover,
    branchLoadIdRef,
    loadBranches,
    loadRepoData,
  } = model;
  const handleCheckoutBranch = useCallback(
    async (branchName: string): Promise<void> => {
      try {
        await gitService.switchBranch(activeRepo, branchName);
        await loadRepoData();
        setShowBranchPopover(false);
      } catch (err) {
        console.error(err);
      }
    },
    [activeRepo, loadRepoData],
  );

  /** Create a new branch and optionally check it out. */
  const handleCreateBranch = useCallback(
    async (branchName: string): Promise<void> => {
      try {
        await gitService.createBranch(activeRepo, branchName, true);
        await loadRepoData();
        setShowBranchPopover(false);
      } catch (err) {
        console.error(err);
      }
    },
    [activeRepo, loadRepoData],
  );

  /** Delete a local or remote branch. */
  const handleDeleteBranch = useCallback(
    async (branchName: string, force: boolean): Promise<void> => {
      try {
        await gitService.deleteBranch(activeRepo, branchName, force);

        // Reflect the successful mutation synchronously so an older
        // in-flight request cannot put the deleted row back.
        branchLoadIdRef.current += 1;
        if (branchName.startsWith("origin/")) {
          setRemoteBranches((branches) =>
            branches.filter((b) => b !== branchName),
          );
        } else {
          setLocalBranches((branches) =>
            branches.filter((b) => b !== branchName),
          );
        }
        await loadBranches(activeRepo, false);
      } catch (err) {
        console.error(err);
        throw err;
      }
    },
    [activeRepo, loadBranches],
  );

  /** Toggle the branch manager popover. */
  const handleBranchPopoverToggle = useCallback((): void => {
    const opening = !showBranchPopover;
    setShowBranchPopover(opening);
    if (opening) {
      void loadBranches(activeRepo);
    }
  }, [showBranchPopover, activeRepo, loadBranches]);

  /** Close the branch manager popover. */
  const handleCloseBranchPopover = useCallback((): void => {
    setShowBranchPopover(false);
  }, []);

  /** Merge a branch into the current branch. */
  const handleMergeBranch = useCallback(
    async (branchName: string): Promise<void> => {
      if (disableBranchOnlyActions) return;
      try {
        await gitService.mergeBranch(activeRepo, branchName);
        await loadRepoData();
        setShowBranchPopover(false);
      } catch (err) {
        console.error(err);
      }
    },
    [activeRepo, disableBranchOnlyActions, loadRepoData],
  );

  /** Rebase the current branch onto another branch. */
  const handleRebaseBranch = useCallback(
    async (branchName: string): Promise<void> => {
      if (disableBranchOnlyActions) return;
      try {
        await gitService.rebaseBranch(activeRepo, branchName);
        await loadRepoData();
        setShowBranchPopover(false);
      } catch (err) {
        console.error(err);
      }
    },
    [activeRepo, disableBranchOnlyActions, loadRepoData],
  );

  /** Abort a pending merge or rebase. */
  const handleAbortPending = useCallback(async (): Promise<void> => {
    try {
      await gitService.abortPending(activeRepo);
      await loadRepoData();
    } catch (err) {
      console.error(err);
    }
  }, [activeRepo, loadRepoData]);

  /** Undo the last file rename / move. */
  const handleUndoRename = useCallback(async (): Promise<void> => {
    if (!lastRename) return;
    try {
      await gitService.undoLastRename(
        activeRepo,
        lastRename.originalPath,
        lastRename.newPath,
      );
      setLastRename(null);
      await loadRepoData();
    } catch (err) {
      console.error(err);
    }
  }, [activeRepo, lastRename, setLastRename, loadRepoData]);

  /** Open the diff tab for a file. */

  return {
    handleCheckoutBranch,
    handleCreateBranch,
    handleDeleteBranch,
    handleBranchPopoverToggle,
    handleCloseBranchPopover,
    handleMergeBranch,
    handleRebaseBranch,
    handleAbortPending,
    handleUndoRename,
  };
}
