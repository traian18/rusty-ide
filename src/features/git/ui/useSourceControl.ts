import { useState, useEffect, useRef, useCallback } from "react";
import { useWorkspaceStore } from "../../../store";
import { branchOnlyActionsDisabledReason, formatHeadLabel, isDetachedOrUnborn } from "../gitHeadLabel";
import { useConfirm } from "../../../lib/ui/useConfirm";
import { buildUnstagedList } from "../sourceControlHelpers";
import { gitClient } from "../client";

export function useSourceControl() {
  // ── Store ──────────────────────────────────────────────────
  const rootPath = useWorkspaceStore((state) => state.rootPath);
  const gitStatusSingleSlot = useWorkspaceStore((state) => state.gitStatus);
  const statusByRepositoryId = useWorkspaceStore((state) => state.statusByRepositoryId);
  const loadGitStatus = useWorkspaceStore((state) => state.loadGitStatus);
  const openTab = useWorkspaceStore((state) => state.openTab);
  const lastRename = useWorkspaceStore((state) => state.lastRename);
  const setLastRename = useWorkspaceStore((state) => state.setLastRename);
  const repositoriesLoading = useWorkspaceStore((state) => state.repositoriesLoading);
  const repositories = useWorkspaceStore((state) => state.repositories);
  const activeRepositoryId = useWorkspaceStore((state) => state.activeRepositoryId);
  const setActiveRepositoryId = useWorkspaceStore((state) => state.setActiveRepositoryId);
  const discoverRepositories = useWorkspaceStore((state) => state.discoverRepositories);
  const initSubmodule = useWorkspaceStore((state) => state.initSubmodule);
  const updateSubmodule = useWorkspaceStore((state) => state.updateSubmodule);
  const syncSubmodule = useWorkspaceStore((state) => state.syncSubmodule);

  // `activeRepo`/`subprojects` used to be local component state, populated
  // by the naive `scanSubprojects()` filesystem walk (REFACTOR_PLAN.md PR
  // 5b commit 16) -- both now derive from the store's Git-native
  // `repositories`/`activeRepositoryId`, which `discoverRepositories()`
  // populates below. `activeRepo` still resolves to a plain worktree path
  // string, since every call site below (gitService, invoke, openTab)
  // takes a rootDir string, not a repository id.
  const activeRepository = repositories.find((repo) => repo.id === activeRepositoryId) ?? null;
  const activeRepo = activeRepository?.worktreePath ?? rootPath;
  const subprojects = repositories.map((repo) => repo.worktreePath);

  // Never borrow the workspace/previous repository status while loading.
  const gitStatus = activeRepository
    ? statusByRepositoryId[activeRepository.id] ?? null
    : repositories.length === 0 ? gitStatusSingleSlot : null;

  // Real HEAD state for the active repository (REFACTOR_PLAN.md PR 5b
  // commit 22) -- branch-only actions (push/pull the current branch, merge
  // or rebase it) have no meaning with no current branch to act on, so
  // they're disabled with an explanation instead of being sent to the
  // backend to fail. Defaults to "on a branch" (nothing disabled) when the
  // repository hasn't been discovered yet, matching this PR's established
  // fallback shape elsewhere.
  const activeHead = activeRepository?.head ?? null;
  const headLabel = activeHead ? formatHeadLabel(activeHead) : gitStatus?.currentBranch || "Loading…";
  const disableBranchOnlyActions = activeHead ? isDetachedOrUnborn(activeHead) : false;
  const branchOnlyActionsReason = activeHead ? branchOnlyActionsDisabledReason(activeHead) : undefined;

  // ── Local State ────────────────────────────────────────────
  const [commitMsg, setCommitMsg] = useState("");
  const [isCommitting, setIsCommitting] = useState(false);
  const [isPushing, setIsPushing] = useState(false);
  const [isPulling, setIsPulling] = useState(false);
  const [initLoading, setInitLoading] = useState(false);
  const [submoduleActionLoading, setSubmoduleActionLoading] = useState<"init" | "update" | "sync" | null>(null);
  const [localBranches, setLocalBranches] = useState<string[]>([]);
  const [remoteBranches, setRemoteBranches] = useState<string[]>([]);
  const isHistoryExpanded = useWorkspaceStore((state) => state.gitHistoryExpanded);
  const setIsHistoryExpanded = useWorkspaceStore((state) => state.setGitHistoryExpanded);
  const [historyCommits, setHistoryCommits] = useState<any[]>([]);
  const [showBranchPopover, setShowBranchPopover] = useState(false);
  const [isRepoDataLoading, setIsRepoDataLoading] = useState(false);
  const [fileContextMenu, setFileContextMenu] = useState<{
    x: number;
    y: number;
    file: any;
  } | null>(null);

  /** Used to ignore stale fetch responses after a fast branch mutation. */
  const branchLoadIdRef = useRef(0);
  const repoDataSequence = useRef(0);

  const { confirm, ConfirmModalComponent } = useConfirm();

  // ── Derived Data ───────────────────────────────────────────
  const unstagedList = buildUnstagedList(gitStatus, lastRename);
  const modifiedList = unstagedList.filter(
    (file) => file.status_type !== "untracked",
  );
  const untrackedList = unstagedList.filter(
    (file) => file.status_type === "untracked",
  );
  const totalChanges =
    (gitStatus?.staged.length || 0) + unstagedList.length;

  // ── Effects ────────────────────────────────────────────────

  /** Discover Git repositories (workspace root, linked worktrees,
      submodules) when rootPath changes. */
  useEffect(() => {
    if (!rootPath) return;
    discoverRepositories();
  }, [rootPath, discoverRepositories]);

  /** Fetch local and remote branches from the Tauri backend. */
  const loadBranches = useCallback(
    async (rootDir: string, fetchRemote = true): Promise<void> => {
      if (!rootDir) return;

      const loadId = ++branchLoadIdRef.current;

      try {
        if (fetchRemote) {
          try {
            await gitClient.fetch(rootDir);
          } catch (e) {
            console.warn(
              "Failed to refresh remote branches; using local refs:",
              e,
            );
          }
        }

        const res: { local: string[]; remote: string[] } = await gitClient.branches(rootDir);
        if (loadId !== branchLoadIdRef.current) return;
        setLocalBranches(res.local || []);
        setRemoteBranches(res.remote || []);
      } catch (e) {
        console.warn("Failed to load branches for current repo:", e);
      }
    },
    [],
  );

  /** Reload Git status, branches, and commit history when switching repos. */
  const loadRepoData = useCallback(async (): Promise<void> => {
    if (!activeRepo) {
      setIsRepoDataLoading(false);
      return;
    }
    const sequence = ++repoDataSequence.current;
    setIsRepoDataLoading(true);
    try {
      await loadGitStatus(activeRepo);
      if (sequence !== repoDataSequence.current) return;

      try {
        const history: any[] = await gitClient.commitHistory(activeRepo);
        if (sequence !== repoDataSequence.current) return;
        setHistoryCommits(history.slice(0, 15));
      } catch (e) {
        console.warn("Failed to load history commits for current repo:", e);
      }

      if (sequence !== repoDataSequence.current) return;
      await loadBranches(activeRepo);
    } catch (err) {
      console.error("Failed to load repo data:", err);
    } finally {
      if (sequence === repoDataSequence.current) setIsRepoDataLoading(false);
    }
  }, [activeRepo, loadGitStatus, loadBranches]);

  /** React to activeRepo changes. */
  useEffect(() => {
    branchLoadIdRef.current += 1;
    setLocalBranches([]);
    setRemoteBranches([]);
    setHistoryCommits([]);
    setShowBranchPopover(false);
    setFileContextMenu(null);
    loadRepoData();
    return () => { repoDataSequence.current += 1; branchLoadIdRef.current += 1; };
  }, [activeRepo, activeRepositoryId, loadRepoData]);

  /** Close file context menu when clicking outside. */
  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent): void => {
      const target = e.target as HTMLElement;
      if (target.closest("[data-context-menu]")) return;
      setFileContextMenu(null);
    };

    if (fileContextMenu) {
      document.addEventListener("mousedown", handleOutsideClick);
      return () => document.removeEventListener("mousedown", handleOutsideClick);
    }
  }, [fileContextMenu]);



  return {
    rootPath,
    gitStatusSingleSlot,
    statusByRepositoryId,
    loadGitStatus,
    openTab,
    lastRename,
    setLastRename,
    repositoriesLoading,
    repositories,
    activeRepositoryId,
    setActiveRepositoryId,
    discoverRepositories,
    initSubmodule,
    updateSubmodule,
    syncSubmodule,
    activeRepository,
    activeRepo,
    subprojects,
    gitStatus,
    activeHead,
    headLabel,
    disableBranchOnlyActions,
    branchOnlyActionsReason,
    commitMsg,
    setCommitMsg,
    isCommitting,
    setIsCommitting,
    isPushing,
    setIsPushing,
    isPulling,
    setIsPulling,
    initLoading,
    setInitLoading,
    submoduleActionLoading,
    setSubmoduleActionLoading,
    localBranches,
    setLocalBranches,
    remoteBranches,
    setRemoteBranches,
    isHistoryExpanded,
    setIsHistoryExpanded,
    historyCommits,
    setHistoryCommits,
    showBranchPopover,
    setShowBranchPopover,
    isRepoDataLoading,
    setIsRepoDataLoading,
    fileContextMenu,
    setFileContextMenu,
    branchLoadIdRef,
    repoDataSequence,
    confirm,
    unstagedList,
    modifiedList,
    untrackedList,
    totalChanges,
    loadBranches,
    loadRepoData,
    ConfirmModalComponent,
  };
}

export type SourceControlModel = ReturnType<typeof useSourceControl>;
