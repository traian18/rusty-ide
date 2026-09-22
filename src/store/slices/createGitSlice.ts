import { invoke } from "@tauri-apps/api/core";
import type { GitHeadState, GitRepository, GitStatusResult, SubmoduleState } from "../types";
import type { WorkspaceSliceCreator } from "../sliceTypes";

/** Shared by both the deprecated single-slot loader and the per-repository
    one below -- git_status's wire shape hasn't changed, only who calls it. */
function mapGitStatusResult(result: any): GitStatusResult {
  return {
    isRepo: result.is_repo,
    currentBranch: result.current_branch,
    staged: (result.staged || []).map((file: any) => ({
      path: file.path,
      name: file.name,
      status_type: file.status_type,
    })),
    unstaged: (result.unstaged || []).map((file: any) => ({
      path: file.path,
      name: file.name,
      status_type: file.status_type,
    })),
  };
}

function mapGitHeadState(head: any): GitHeadState {
  return { mode: head.mode, branch: head.branch ?? null, oid: head.oid ?? null };
}

function mapSubmoduleState(state: any): SubmoduleState | null {
  if (!state) return null;
  return {
    changedGitlink: state.changed_gitlink,
    modifiedWorktree: state.modified_worktree,
    untrackedContent: state.untracked_content,
  };
}

function mapGitRepository(raw: any): GitRepository {
  return {
    id: raw.id,
    worktreePath: raw.worktree_path,
    gitDir: raw.git_dir,
    kind: raw.kind,
    parentId: raw.parent_id ?? null,
    submodulePath: raw.submodule_path ?? null,
    initialized: raw.initialized,
    head: mapGitHeadState(raw.head),
    submoduleState: mapSubmoduleState(raw.submodule_state),
  };
}

export const createGitSlice: WorkspaceSliceCreator = (set, get) => {
  let discoverySequence = 0;
  const statusSequences = new Map<string, number>();
  let discoveredRoot: string | null = null;

  /** After a submodule action changes what it has checked out (init only
      registers config, so it's a no-op for that one -- harmless), refreshes
      both the submodule's own status and its parent's (REFACTOR_PLAN.md PR
      5b commit 24) -- the parent's `git status` is what actually shows the
      changed gitlink, so a parent already open in Source Control sees it
      immediately instead of only after some unrelated later refresh. */
  const refreshSubmoduleAndParentStatus = async (repositoryId: string) => {
    const repo = get().repositories.find((candidate) => candidate.id === repositoryId);
    if (!repo) return;
    const targetIds = [repo.id, repo.parentId].filter((id): id is string => Boolean(id));
    await Promise.all(targetIds.map((id) => get().loadRepositoryGitStatus(id)));
  };

  return {
    gitStatus: null,
    repositories: [],
    repositoriesLoading: false,
    statusByRepositoryId: {},
    activeRepositoryId: null,
    lastRename: null,

    setGitStatus: (gitStatus) => set({ gitStatus }),
    setActiveRepositoryId: (activeRepositoryId) => set({ activeRepositoryId }),
    setLastRename: (lastRename) => set({ lastRename }),

    loadGitStatus: async (rootDir) => {
      const rootPath = rootDir || get().rootPath;
      if (!rootPath) {
        set({ gitStatus: null });
        return;
      }
      const workspaceRoot = get().rootPath;
      const repository = get().repositories.find((repo) => repo.worktreePath === rootPath);
      if (repository) {
        await get().loadRepositoryGitStatus(repository.id);
        return;
      }
      try {
        const result: any = await invoke("git_status", { rootDir: rootPath });
        if (get().rootPath !== workspaceRoot) return;
        const status = mapGitStatusResult(result);
        set((state) => {
          // Opportunistically mirrors into the new per-repository bucket too
          // (REFACTOR_PLAN.md PR 5b commit 20), so consumers that have moved
          // onto statusByRepositoryId (NavigationRailPresenter's badge,
          // FileTree's markers) see real data as soon as *anything* still
          // calls this deprecated loader -- without this, statusByRepositoryId
          // would stay empty until every caller migrates to
          // loadRepositoryGitStatus, which hasn't happened yet. Only mirrors
          // when repositories has already resolved a match; silently a no-op
          // otherwise (e.g. right at startup, before discoverRepositories has
          // run) rather than guessing which repository this status belongs to.
          const matchingRepo = state.repositories.find((repo) => repo.worktreePath === rootPath);
          return {
            gitStatus: status,
            statusByRepositoryId: matchingRepo
              ? { ...state.statusByRepositoryId, [matchingRepo.id]: status }
              : state.statusByRepositoryId,
          };
        });
      } catch (error) {
        console.error("Failed to load git status:", error);
      }
    },

    discoverRepositories: async () => {
      const sequence = ++discoverySequence;
      const rootPath = get().rootPath;
      if (discoveredRoot !== rootPath) {
        discoveredRoot = rootPath;
        set({ repositories: [], activeRepositoryId: null, statusByRepositoryId: {}, gitStatus: null });
      }
      if (!rootPath) {
        set({ repositoriesLoading: false });
        return;
      }
      set({ repositoriesLoading: true });
      try {
        const raw = await invoke<any[]>("git_discover_workspace_repositories", { rootDir: rootPath });
        if (sequence !== discoverySequence || get().rootPath !== rootPath) return;
        const repositories = raw.map(mapGitRepository);
        set((state) => ({
          repositories,
          statusByRepositoryId: Object.fromEntries(Object.entries(state.statusByRepositoryId)
            .filter(([id]) => repositories.some((repo) => repo.id === id))),
          activeRepositoryId: repositories.some((repo) => repo.id === state.activeRepositoryId)
            ? state.activeRepositoryId : repositories[0]?.id ?? null,
        }));
      } catch (error) {
        console.error("Failed to discover git repositories:", error);
      } finally {
        if (sequence === discoverySequence && get().rootPath === rootPath) set({ repositoriesLoading: false });
      }
    },

    loadRepositoryGitStatus: async (repositoryId) => {
      const repo = get().repositories.find((candidate) => candidate.id === repositoryId);
      if (!repo || !repo.initialized) return;
      const workspaceRoot = get().rootPath;
      const sequence = (statusSequences.get(repositoryId) ?? 0) + 1;
      statusSequences.set(repositoryId, sequence);
      try {
        const [result, head] = await Promise.all([
          invoke<any>("git_status", { rootDir: repo.worktreePath }),
          invoke<any>("git_discover_repository", { rootDir: repo.worktreePath }),
        ]);
        if (get().rootPath !== workspaceRoot || statusSequences.get(repositoryId) !== sequence) return;
        const status = mapGitStatusResult(result);
        set((state) => ({
          gitStatus: repo.worktreePath === workspaceRoot ? status : state.gitStatus,
          repositories: state.repositories.map((candidate) => candidate.id === repositoryId
            ? { ...candidate, head: mapGitHeadState(head.head) } : candidate),
          statusByRepositoryId: { ...state.statusByRepositoryId, [repositoryId]: status },
        }));
      } catch (error) {
        console.error(`Failed to load git status for repository ${repositoryId}:`, error);
      }
    },

    initSubmodule: async (repositoryId) => {
      const repo = get().repositories.find((candidate) => candidate.id === repositoryId);
      const rootPath = get().repositories.find((parent) => parent.id === repo?.parentId)?.worktreePath;
      if (!repo || repo.kind !== "submodule" || !repo.submodulePath || !rootPath) return;
      await invoke("git_submodule_init", { rootDir: rootPath, submodulePath: repo.submodulePath });
      await get().discoverRepositories();
      await refreshSubmoduleAndParentStatus(repositoryId);
    },

    updateSubmodule: async (repositoryId, recursive) => {
      const repo = get().repositories.find((candidate) => candidate.id === repositoryId);
      const rootPath = get().repositories.find((parent) => parent.id === repo?.parentId)?.worktreePath;
      if (!repo || repo.kind !== "submodule" || !repo.submodulePath || !rootPath) return;
      await invoke("git_submodule_update", { rootDir: rootPath, submodulePath: repo.submodulePath, recursive });
      await get().discoverRepositories();
      await refreshSubmoduleAndParentStatus(repositoryId);
    },

    syncSubmodule: async (repositoryId) => {
      const repo = get().repositories.find((candidate) => candidate.id === repositoryId);
      const rootPath = get().repositories.find((parent) => parent.id === repo?.parentId)?.worktreePath;
      if (!repo || repo.kind !== "submodule" || !repo.submodulePath || !rootPath) return;
      await invoke("git_submodule_sync", { rootDir: rootPath, submodulePath: repo.submodulePath });
      await get().discoverRepositories();
      await refreshSubmoduleAndParentStatus(repositoryId);
    },
  };
};
