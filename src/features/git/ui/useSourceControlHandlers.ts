import type { SourceControlModel } from "./useSourceControl";
import { useCallback } from "react";
import { gitService } from "./gitService";
import { gitErrorMessage } from "../gitErrors";
import { notify } from "../../notifications";
import { buildGitDiffRequest } from "../../../app/tabs/gitDiffRequest";
import { gitClient } from "../client";

export function useSourceControlHandlers(model: SourceControlModel) {
  const {
    openTab,
    repositories,
    activeRepositoryId,
    setActiveRepositoryId,
    discoverRepositories,
    initSubmodule,
    updateSubmodule,
    syncSubmodule,
    activeRepo,
    gitStatus,
    disableBranchOnlyActions,
    commitMsg,
    setCommitMsg,
    isCommitting,
    setIsCommitting,
    isPushing,
    setIsPushing,
    isPulling,
    setIsPulling,
    setInitLoading,
    submoduleActionLoading,
    setSubmoduleActionLoading,
    setFileContextMenu,
    confirm,
    loadRepoData,
  } = model;

  // ── Event Handlers ────────────────────────────────────────

  /** Open the full commit graph tab. */
  const handleOpenGraph = useCallback((): void => {
    openTab({
      type: "git-history",
      repoPath: activeRepo,
    });
  }, [openTab, activeRepo]);

  /** Initialise a Git repository in the current folder. */
  const handleInitializeRepo = useCallback(async (): Promise<void> => {
    setInitLoading(true);
    try {
      console.log(`Git: Initializing repository at ${activeRepo}`);
      await gitClient.init(activeRepo);
      await discoverRepositories();
      await loadRepoData();
    } catch (err: any) {
      console.error("Failed to initialize git repository:", err);
      notify("Error", `Error initializing Git: ${gitErrorMessage(err)}`, "error");
    } finally {
      setInitLoading(false);
    }
  }, [activeRepo, loadRepoData, discoverRepositories]);

  /** Commit all staged changes. */
  const handleCommit = useCallback(
    async (e?: React.FormEvent): Promise<void> => {
      if (e) e.preventDefault();
      if (!commitMsg.trim() || isCommitting || !gitStatus) return;

      if (gitStatus.staged.length === 0) {
        notify(
          "Nothing to commit",
          "Please stage your changes before committing.",
          "info",
        );
        return;
      }

      setIsCommitting(true);
      try {
        await gitService.commit(activeRepo, commitMsg);
        setCommitMsg("");
        await loadRepoData();
      } catch (err) {
        console.error(err);
      } finally {
        setIsCommitting(false);
      }
    },
    [activeRepo, commitMsg, gitStatus, isCommitting, loadRepoData],
  );

  /** Pull latest changes from the remote. */
  const handlePull = useCallback(async (): Promise<void> => {
    if (!activeRepo || isPulling || disableBranchOnlyActions) return;
    setIsPulling(true);
    try {
      await gitService.pull(activeRepo);
      await loadRepoData();
    } catch (err) {
      console.error(err);
    } finally {
      setIsPulling(false);
    }
  }, [activeRepo, isPulling, disableBranchOnlyActions, loadRepoData]);

  /** Push local commits to the remote. */
  const handlePush = useCallback(async (): Promise<void> => {
    if (!activeRepo || !gitStatus || isPushing || disableBranchOnlyActions) return;
    setIsPushing(true);
    try {
      await gitService.push(activeRepo, gitStatus.currentBranch);
      await loadRepoData();
    } catch (err) {
      console.error(err);
    } finally {
      setIsPushing(false);
    }
  }, [activeRepo, gitStatus, isPushing, disableBranchOnlyActions, loadRepoData]);

  /** Stage a single file. */
  const handleStageFile = useCallback(
    async (e: React.MouseEvent, filePath: string): Promise<void> => {
      e.stopPropagation();
      try {
        await gitService.stageFile(activeRepo, filePath);
        await loadRepoData();
      } catch (err) {
        console.error(err);
      }
    },
    [activeRepo, loadRepoData],
  );

  /** Unstage a single file. */
  const handleUnstageFile = useCallback(
    async (e: React.MouseEvent, filePath: string): Promise<void> => {
      e.stopPropagation();
      try {
        await gitService.unstageFile(activeRepo, filePath);
        await loadRepoData();
      } catch (err) {
        console.error(err);
      }
    },
    [activeRepo, loadRepoData],
  );

  /** Add a file to .gitignore. */
  const handleAddToGitignore = useCallback(
    async (filePath: string): Promise<void> => {
      try {
        await gitService.addToGitignore(activeRepo, filePath);
        await loadRepoData();
      } catch (err) {
        console.error(err);
      }
    },
    [activeRepo, loadRepoData],
  );

  /** Show the right-click context menu for a file. */
  const handleFileContextMenu = useCallback(
    (e: React.MouseEvent, file: any): void => {
      e.preventDefault();
      e.stopPropagation();
      setFileContextMenu({ x: e.clientX, y: e.clientY, file });
    },
    [],
  );

  /** Discard all unstaged changes in a single file. */
  const handleDiscardChanges = useCallback(
    async (
      e: React.MouseEvent,
      filePath: string,
      fileName: string,
    ): Promise<void> => {
      e.stopPropagation();
      try {
        await gitService.discardChanges(
          activeRepo,
          filePath,
          fileName,
          async (title, msg) => {
            return await confirm({
              title,
              message: msg,
              kind: "warning",
            });
          },
        );
        await loadRepoData();
      } catch (err) {
        console.error(err);
      }
    },
    [activeRepo, confirm, loadRepoData],
  );

  /** Discard all unstaged changes across the whole repo. */
  const handleDiscardAllChanges = useCallback(async (): Promise<void> => {
    try {
      await gitService.discardAllChanges(
        activeRepo,
        async (title, msg) => {
          return await confirm({
            title,
            message: msg,
            kind: "danger",
          });
        },
      );
      await loadRepoData();
    } catch (err) {
      console.error(err);
    }
  }, [activeRepo, confirm, loadRepoData]);

  /** Checkout (switch to) a branch. */
  const handleOpenFileDiff = useCallback(
    (
      filePath: string,
      _fileName: string,
      diffType: "staged" | "unstaged",
    ): void => {
      openTab(buildGitDiffRequest({
        repoPath: activeRepo,
        path: filePath,
        diffType,
      }));
    },
    [openTab, activeRepo],
  );

  /** Switch the active repository. */
  const handleRepoChange = useCallback(
    (repo: string): void => {
      const match = repositories.find((candidate) => candidate.worktreePath === repo);
      setActiveRepositoryId(match ? match.id : null);
    },
    [repositories, setActiveRepositoryId],
  );

  /** Register/clone/re-sync the active repository's submodule
      (REFACTOR_PLAN.md PR 5b commit 23) -- a no-op for any repository that
      isn't a submodule, enforced by the store action itself. */
  const handleSubmoduleAction = useCallback(
    async (action: "init" | "update" | "sync"): Promise<void> => {
      if (!activeRepositoryId || submoduleActionLoading) return;
      setSubmoduleActionLoading(action);
      try {
        if (action === "init") await initSubmodule(activeRepositoryId);
        else if (action === "update") await updateSubmodule(activeRepositoryId, true);
        else await syncSubmodule(activeRepositoryId);
        notify(
          "Submodule updated",
          action === "init"
            ? "Submodule registered locally."
            : action === "update"
              ? "Submodule cloned/checked out."
              : "Submodule URL synced from .gitmodules.",
          "success",
        );
      } catch (err) {
        console.error(`Submodule ${action} failed:`, err);
        notify(`Submodule ${action} failed`, gitErrorMessage(err), "error");
      } finally {
        setSubmoduleActionLoading(null);
      }
    },
    [activeRepositoryId, submoduleActionLoading, initSubmodule, updateSubmodule, syncSubmodule],
  );

  return {
    handleOpenGraph,
    handleInitializeRepo,
    handleCommit,
    handlePull,
    handlePush,
    handleStageFile,
    handleUnstageFile,
    handleAddToGitignore,
    handleFileContextMenu,
    handleDiscardChanges,
    handleDiscardAllChanges,
    handleOpenFileDiff,
    handleRepoChange,
    handleSubmoduleAction,
  };
}
