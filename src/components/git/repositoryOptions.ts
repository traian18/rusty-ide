import type { GitRepository } from "../../store/types";

export interface RepositoryOption {
  /** The repository's worktree path. */
  id: string;
  name: string;
}

/**
 * The choices for a repository selector: the workspace root and every repository found under it,
 * named relative to the workspace root, with worktrees and submodules marked. Shared by the Git
 * sidebar and the architecture tab so both list repositories the same way.
 */
export function repositoryOptions(repositories: readonly GitRepository[], rootPath: string): RepositoryOption[] {
  const root = rootPath.replace(/\\/g, "/").replace(/\/$/, "");
  return repositories.map((repository) => {
    const normalized = repository.worktreePath.replace(/\\/g, "/");
    const name =
      normalized === root
        ? `${root.split("/").pop()} (workspace)`
        : normalized.startsWith(`${root}/`)
          ? normalized.slice(root.length + 1)
          : normalized;
    const suffix = repository.kind === "worktree" || repository.kind === "submodule" ? ` (${repository.kind})` : "";
    return { id: repository.worktreePath, name: `${name}${suffix}` };
  });
}
