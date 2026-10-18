/** What a chat run tells the host about the work in progress, so repository documentation can anchor on it. */
import { repositoryContextEnabled } from "./repositoryContextSettings";

interface TabsState {
  tabs: { id: string; type: string; path?: string }[];
  activeTabId: string | null;
  /** The repositories of the workspace folder and the one chosen in the IDE. */
  repositories?: { id: string; worktreePath: string }[];
  activeRepositoryId?: string | null;
}

/** An absolute path relative to the workspace root, or null when it lies outside it. */
export function relativeToRoot(path: string, root: string): string | null {
  const base = root.replace(/[\\/]+$/, "");
  if (!base || !path.startsWith(`${base}/`)) return null;
  return path.slice(base.length + 1);
}

export function repositoryContextInput(state: TabsState, root: string | null | undefined, task?: string, enabled: () => boolean = repositoryContextEnabled) {
  if (!root || !enabled()) return { enabled: false } as const;
  const active = state.tabs.find((tab) => tab.id === state.activeTabId);
  const activeFile = active?.type === "file" && active.path ? relativeToRoot(active.path, root) : null;
  const repository = state.repositories?.find((candidate) => candidate.id === state.activeRepositoryId);
  return { enabled: true, ...(activeFile ? { activeFile } : {}), ...(repository ? { activeRepository: repository.worktreePath } : {}), ...(task ? { task } : {}) } as const;
}
