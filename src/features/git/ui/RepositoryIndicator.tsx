import React, { useEffect } from "react";
import { FolderGit2, GitBranch, GitMerge } from "lucide-react";
import { useWorkspaceStore } from "../../../store";
import { listen } from "../../../lib/platform/events";
import { repositoryIndicator } from "../repositoryIndicator";
import styles from "./RepositoryIndicator.module.css";

/** A checkout or a commit writes several git files in a row. */
const GIT_REFRESH_DELAY_MS = 250;

/**
 * The project git is acting on and its branch, always in the title bar. Follows
 * the repository selected in Source Control, and stays right when the branch
 * changes outside the app: git's own files are watched, and worktrees and
 * submodules, whose files live elsewhere, catch up when the window regains focus.
 */
export const RepositoryIndicator: React.FC = () => {
  const rootPath = useWorkspaceStore((state) => state.rootPath);
  const repositories = useWorkspaceStore((state) => state.repositories);
  const activeRepositoryId = useWorkspaceStore((state) => state.activeRepositoryId);
  const status = useWorkspaceStore((state) =>
    (state.activeRepositoryId ? state.statusByRepositoryId[state.activeRepositoryId] : null) ?? state.gitStatus);
  const discoverRepositories = useWorkspaceStore((state) => state.discoverRepositories);
  const openDrawer = useWorkspaceStore((state) => state.openDrawer);
  const openTab = useWorkspaceStore((state) => state.openTab);

  useEffect(() => {
    if (rootPath) void discoverRepositories();
  }, [rootPath, discoverRepositories]);

  useEffect(() => {
    if (!rootPath) return;
    const refresh = () => {
      const { activeRepositoryId: active, loadRepositoryGitStatus, loadGitStatus } = useWorkspaceStore.getState();
      void (active ? loadRepositoryGitStatus(active) : loadGitStatus());
    };
    let timer: ReturnType<typeof setTimeout> | undefined;
    const scheduleRefresh = () => {
      clearTimeout(timer);
      timer = setTimeout(refresh, GIT_REFRESH_DELAY_MS);
    };
    refresh();
    window.addEventListener("focus", scheduleRefresh);
    const unlisten = listen("workspace-git-changed", scheduleRefresh).catch((err) => {
      console.error("Failed to listen for workspace-git-changed:", err);
      return undefined;
    });
    return () => {
      clearTimeout(timer);
      window.removeEventListener("focus", scheduleRefresh);
      void unlisten.then((stop) => stop?.());
    };
  }, [rootPath, activeRepositoryId]);

  const indicator = repositoryIndicator(repositories, activeRepositoryId, rootPath, status);
  if (!indicator) return null;
  const { project, branch, path, pendingOperation, conflicts } = indicator;
  const unfinished = pendingOperation !== null || conflicts > 0;

  return (
    <div className={styles.indicator}>
      <button
        type="button"
        className={styles.target}
        title={branch ? `${path} on ${branch}` : path}
        aria-label={branch ? `Project ${project}, branch ${branch}. Open Source Control` : `Project ${project}. Open Source Control`}
        onClick={() => openDrawer("git")}
      >
        <FolderGit2 size={12} className={styles.icon} aria-hidden="true" />
        <span className={styles.project}>{project}</span>
        {branch && (
          <>
            <GitBranch size={12} className={styles.icon} aria-hidden="true" />
            <span className={styles.branch}>{branch}</span>
          </>
        )}
      </button>
      {unfinished && (
        <button
          type="button"
          className={styles.pending}
          title={conflicts > 0 ? "Open the merge window" : "Open the merge window to finish"}
          onClick={() => openTab({ type: "git-merge", repoPath: path })}
        >
          <GitMerge size={11} aria-hidden="true" />
          <span>{conflicts > 0 ? `${conflicts} ${conflicts === 1 ? "conflict" : "conflicts"}` : pendingOperation}</span>
        </button>
      )}
    </div>
  );
};
