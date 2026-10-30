import React from "react";
import { FolderGit2 } from "lucide-react";
import type { GitRepository } from "../../../../store/types";
import { CompactSelect } from "../../../../lib/ui/CompactSelect";
import { repositoryOptions } from "../../repositoryOptions";

interface RepoSelectorProps {
  subprojects: string[];
  activeRepo: string;
  rootPath: string;
  /** Looked up per-option purely to show its `kind` (REFACTOR_PLAN.md PR
      5b commit 23) -- the dropdown's own value/selection logic still keys
      off the plain worktree path strings in `subprojects`. */
  repositories: GitRepository[];
  onRepoChange: (repo: string) => void;
}

/**
 * Dropdown that lets the user switch between the workspace root
 * and any discovered subproject repositories.
 */
export const RepoSelector: React.FC<RepoSelectorProps> = ({
  subprojects,
  activeRepo,
  rootPath,
  repositories,
  onRepoChange,
}) => {
  return (
    <div className="px-4 py-2 border-b border-[var(--border-color)]/60 bg-[var(--color-surface-sunken)] flex items-center justify-between gap-2 flex-shrink-0">
      <label htmlFor="source-control-repository" className="font-bold text-[var(--text-light)] uppercase tracking-wider text-[10px] font-mono flex-shrink-0">
        Repository
      </label>
      <CompactSelect
        id="source-control-repository"
        value={activeRepo}
        onChange={onRepoChange}
        placeholder="Select repository"
        icon={<FolderGit2 size={10} className="flex-shrink-0 mr-1" />}
        options={repositoryOptions(
          subprojects.map((repo) => repositories.find((candidate) => candidate.worktreePath === repo) ?? ({ worktreePath: repo, kind: "workspace" } as GitRepository)),
          rootPath,
        )}
      />
    </div>
  );
};
