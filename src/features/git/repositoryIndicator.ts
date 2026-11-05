import type { GitRepository, GitStatusResult } from "../../store/types";
import { formatHeadLabel } from "./gitHeadLabel";

export interface RepositoryIndicatorState {
  /** The selected repository in a multi-repo workspace, else the project. */
  project: string;
  /** Empty for a folder that is not a repository. */
  branch: string;
  /** Where the project lives, for the tooltip. */
  path: string;
  pendingOperation: GitStatusResult["pendingOperation"];
  conflicts: number;
}

const lastSegment = (path: string) => path.replace(/\\/g, "/").replace(/\/$/, "").split("/").pop() ?? path;

/**
 * What the title bar says about git: which project git is acting on and on what
 * branch. With several repositories the project is the one selected in Source
 * Control, named relative to the workspace so two `app` folders stay apart;
 * with one it is simply the project's name.
 */
export function repositoryIndicator(
  repositories: readonly GitRepository[],
  activeRepositoryId: string | null,
  rootPath: string,
  status: GitStatusResult | null,
): RepositoryIndicatorState | null {
  if (!rootPath) return null;
  const repository = repositories.find((candidate) => candidate.id === activeRepositoryId) ?? null;
  const pendingOperation = status?.pendingOperation ?? null;
  const conflicts = status?.conflicted.length ?? 0;
  if (!repository) {
    return { project: lastSegment(rootPath), branch: status?.isRepo ? status.currentBranch : "", path: rootPath, pendingOperation, conflicts };
  }

  const root = rootPath.replace(/\\/g, "/").replace(/\/$/, "");
  const worktree = repository.worktreePath.replace(/\\/g, "/").replace(/\/$/, "");
  const project = repositories.length > 1 && worktree.startsWith(`${root}/`) ? worktree.slice(root.length + 1) : lastSegment(worktree);
  return { project, branch: formatHeadLabel(repository.head), path: repository.worktreePath, pendingOperation, conflicts };
}
