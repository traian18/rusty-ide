import type { CommitInfo } from "../model";
import { useEffect, useState } from "react";
import { useWorkspaceStore } from "../../../store";
import { notify } from "../../notifications";
import { useConfirm } from "../../../lib/ui/useConfirm";
import { gitErrorMessage } from "../gitErrors";
import { formatHeadLabel } from "../gitHeadLabel";
import type { TabOfType } from "../../../app/tabs/types";
import { buildGitDiffRequest } from "../../../app/tabs/gitDiffRequest";
import { gitClient } from "../client";
import { explorerClient } from "../../explorer";

export function useGitHistory(tab: TabOfType<"git-history">) {
  const rootPath = useWorkspaceStore((state) => state.rootPath);
  // Falls back to the workspace root for the repo-wide graph opened before
  // subproject selection existed.
  const repoPath = tab?.repoPath ?? rootPath;
  const loadGitStatus = useWorkspaceStore((state) => state.loadGitStatus);
  const gitStatus = useWorkspaceStore((state) => state.gitStatus);
  const repositories = useWorkspaceStore((state) => state.repositories);
  // Real HEAD state for this tab's own repository (REFACTOR_PLAN.md PR 5b
  // commit 18), replacing the `gitStatus?.currentBranch || "detached"`
  // guess -- gitStatus is the deprecated single-slot shim, always scoped to
  // the workspace root, so it was silently wrong for any subproject tab.
  // Falls back to that same guess only if repositories hasn't been
  // discovered yet (e.g. this tab opened before SourceControl ever
  // mounted) -- full cross-refresh guarantees land in commit 24.
  const repository = repositories.find((repo) => repo.worktreePath === repoPath) ?? null;
  const currentBranchName = repository
    ? repository.head.mode === "branch"
      ? repository.head.branch
      : null
    : gitStatus?.currentBranch ?? null;
  const headBadgeLabel = repository ? formatHeadLabel(repository.head) : gitStatus?.currentBranch || "detached";

  const [commits, setCommits] = useState<CommitInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copiedHash, setCopiedHash] = useState<string | null>(null);

  const [isPushing, setIsPushing] = useState(false);
  const [isPulling, setIsPulling] = useState(false);

  const [expandedCommit, setExpandedCommit] = useState<string | null>(null);
  const [commitFiles, setCommitFiles] = useState<any[]>([]);
  const [loadingFiles, setLoadingFiles] = useState(false);
  const openTab = useWorkspaceStore((state) => state.openTab);

  const { confirm, ConfirmModalComponent } = useConfirm();

  const handleToggleExpand = async (commitHash: string) => {
    if (expandedCommit === commitHash) {
      setExpandedCommit(null);
      setCommitFiles([]);
    } else {
      setExpandedCommit(commitHash);
      setCommitFiles([]);
      setLoadingFiles(true);
      try {
        const files: any[] = await gitClient.commitFiles(repoPath, commitHash);
        setCommitFiles(files);
      } catch (err) {
        console.error("Failed to load commit files:", err);
      } finally {
        setLoadingFiles(false);
      }
    }
  };

  const handleOpenFileDiff = (filePath: string, _fileName: string, commitHash: string, _shortHash: string) => {
    openTab(buildGitDiffRequest({
      repoPath: repoPath ?? "",
      path: filePath,
      diffType: "commit",
      commitHash,
    }));
  };

  const handleRevertCommit = async (commitHash: string) => {
    try {
      const confirmRevert = await confirm({
        title: "Revert Commit",
        message: `Are you sure you want to revert commit ${commitHash.substring(0, 7)}? This will create a new commit undoing its modifications.`,
        kind: "warning",
      });
      if (!confirmRevert) return;

      console.log(`Git Graph: Reverting commit ${commitHash}`);
      await gitClient.revertCommit(repoPath, commitHash);
      await handleRefresh();
      // Reload workspace directory tree structure
      const tree = await explorerClient.tree(rootPath);
      useWorkspaceStore.getState().setFileTree(tree);
      notify("Revert complete", "Commit reverted successfully.", "success");
    } catch (err: any) {
      console.error("Revert failed:", err);
      notify("Revert failed", `Revert failed: ${gitErrorMessage(err)}`, "error");
    }
  };

  const handleResetToCommit = async (commitHash: string) => {
    try {
      const confirmReset = await confirm({
        title: "Hard Reset",
        message: `WARNING: Are you sure you want to HARD RESET your current branch to commit ${commitHash.substring(0, 7)}? ALL uncommitted modifications and commits after this point will be DESTROYED.`,
        kind: "danger",
      });
      if (!confirmReset) return;

      console.log(`Git Graph: Resetting branch to ${commitHash}`);
      await gitClient.resetToCommit(repoPath, commitHash);
      await handleRefresh();
      // Reload workspace directory tree structure
      const tree = await explorerClient.tree(rootPath);
      useWorkspaceStore.getState().setFileTree(tree);
      notify("Reset complete", "Branch reset successfully.", "success");
    } catch (err: any) {
      console.error("Reset failed:", err);
      notify("Reset failed", `Reset failed: ${gitErrorMessage(err)}`, "error");
    }
  };

  // Fetch the commit log from the backend
  const fetchCommitHistory = async () => {
    if (!repoPath) return;
    setLoading(true);
    setError(null);
    try {
      const filePath = tab?.path;
      const history: CommitInfo[] = filePath
        ? await gitClient.fileCommitHistory(repoPath, filePath)
        : await gitClient.commitHistory(repoPath);
      setCommits(history);
    } catch (err: any) {
      console.error("Failed to load commit history:", err);
      setError(gitErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  // Run on mount or when root path/tab changes
  useEffect(() => {
    fetchCommitHistory();
  }, [repoPath, tab?.path]);

  // Handle manual refresh
  const handleRefresh = async () => {
    await fetchCommitHistory();
    await loadGitStatus(repoPath);
  };

  // Push changes to remote tracking branch
  const handlePush = async () => {
    if (!repoPath || !currentBranchName || isPushing) return;
    setIsPushing(true);
    try {
      console.log(`Git Graph: Pushing branch "${currentBranchName}"...`);
      await gitClient.push(repoPath, currentBranchName);
      await handleRefresh();
      notify("Push complete", "Successfully pushed commits to remote upstream.", "success");
    } catch (err: any) {
      console.error("Push failed:", err);
      notify("Push failed", `Push failed: ${gitErrorMessage(err)}`, "error");
    } finally {
      setIsPushing(false);
    }
  };

  // Pull changes from remote upstream
  const handlePull = async () => {
    if (!repoPath || isPulling) return;
    setIsPulling(true);
    try {
      console.log("Git Graph: Pulling remote modifications...");
      await gitClient.pull(repoPath);
      await handleRefresh();
      // Reload workspace directory tree structure
      const tree = await explorerClient.tree(rootPath);
      useWorkspaceStore.getState().setFileTree(tree);
      notify("Pull complete", "Successfully pulled changes from remote.", "success");
    } catch (err: any) {
      console.error("Pull failed:", err);
      notify("Pull failed", `Pull failed: ${gitErrorMessage(err)}`, "error");
    } finally {
      setIsPulling(false);
    }
  };

  // Helper to handle hash copying
  const handleCopyHash = (fullHash: string) => {
    navigator.clipboard.writeText(fullHash);
    setCopiedHash(fullHash);
    setTimeout(() => {
      setCopiedHash(null);
    }, 2000);
  };

  // Helper to parse Git decorations into badges

  const unpushedCommitsCount = commits.filter((c) => c.is_unpushed).length;

  const isFileHistory = Boolean(tab.path);
  const fileBasename = tab.path ? tab.path.split(/[/\\]/).pop() || tab.path : "";


  return {
    rootPath,
    repoPath,
    loadGitStatus,
    gitStatus,
    repositories,
    repository,
    currentBranchName,
    headBadgeLabel,
    commits,
    setCommits,
    loading,
    setLoading,
    error,
    setError,
    copiedHash,
    setCopiedHash,
    isPushing,
    setIsPushing,
    isPulling,
    setIsPulling,
    expandedCommit,
    setExpandedCommit,
    commitFiles,
    setCommitFiles,
    loadingFiles,
    setLoadingFiles,
    openTab,
    confirm,
    ConfirmModalComponent,
    handleToggleExpand,
    handleOpenFileDiff,
    handleRevertCommit,
    handleResetToCommit,
    fetchCommitHistory,
    handleRefresh,
    handlePush,
    handlePull,
    handleCopyHash,
    unpushedCommitsCount,
    isFileHistory,
    fileBasename,
    tab,
  };
}

export type GitHistoryModel = ReturnType<typeof useGitHistory>;
