import React from "react";
import { Loader2 } from "lucide-react";
import { GitCommit, RotateCcw } from "lucide-react";
import type { GitRepository, GitStatusResult } from "../../../../store/types";
import { RepoSelector } from "./RepoSelector";
import { SubmoduleActions, SubmoduleActionKind } from "./SubmoduleActions";
import { BranchWidget } from "./BranchWidget";

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────


interface SourceControlHeaderProps {
  subprojects: string[];
  activeRepo: string;
  /** Every discovered repository -- RepoSelector looks up each option's
      `kind` from this (REFACTOR_PLAN.md PR 5b commit 23). */
  repositories: GitRepository[];
  /** Full record for the active repository, when discovered -- drives the
      kind display and submodule actions (REFACTOR_PLAN.md PR 5b commit
      23). Null before repositories has resolved. */
  activeRepository: GitRepository | null;
  rootPath: string;
  gitStatus: GitStatusResult | null;
  isLoading: boolean;
  /** The active repository's real HEAD label (REFACTOR_PLAN.md PR 5b
      commit 22) -- replaces the branch pill's old
      `gitStatus.currentBranch` read, which couldn't represent a detached
      or unborn HEAD correctly. */
  headLabel: string;
  disableBranchOnlyActions: boolean;
  branchOnlyActionsReason?: string;
  submoduleActionLoading: SubmoduleActionKind | null;
  onInitSubmodule: () => void;
  onUpdateSubmodule: () => void;
  onSyncSubmodule: () => void;
  localBranches: string[];
  remoteBranches: string[];
  showBranchPopover: boolean;
  onRepoChange: (repo: string) => void;
  onOpenGraph: () => void;
  onAbortPending: () => Promise<void>;
  onToggleBranchPopover: () => void;
  onCheckoutBranch: (branch: string) => Promise<void>;
  onCreateBranch: (branch: string) => Promise<void>;
  onDeleteBranch: (branch: string, force: boolean) => Promise<void>;
  onMergeBranch: (branch: string) => Promise<void>;
  onRebaseBranch: (branch: string) => Promise<void>;
  onCloseBranchPopover: () => void;
}

// ─────────────────────────────────────────────────────────────
// Sub-Components
// ─────────────────────────────────────────────────────────────


/**
 * Header bar for the Source Control panel.
 *
 * Renders the repository selector (when subprojects exist), the
 * panel title with graph button, the abort button, and the
 * branch widget with its popover manager.
 */
const SourceControlHeader: React.FC<SourceControlHeaderProps> = ({
  subprojects,
  activeRepo,
  repositories,
  activeRepository,
  rootPath,
  gitStatus,
  isLoading,
  headLabel,
  disableBranchOnlyActions,
  branchOnlyActionsReason,
  submoduleActionLoading,
  onInitSubmodule,
  onUpdateSubmodule,
  onSyncSubmodule,
  localBranches,
  remoteBranches,
  showBranchPopover,
  onRepoChange,
  onOpenGraph,
  onAbortPending,
  onToggleBranchPopover,
  onCheckoutBranch,
  onCreateBranch,
  onDeleteBranch,
  onMergeBranch,
  onRebaseBranch,
  onCloseBranchPopover,
}) => {
  return (
    <>
      {subprojects.length > 1 && (
        <RepoSelector
          subprojects={subprojects}
          activeRepo={activeRepo}
          rootPath={rootPath}
          repositories={repositories}
          onRepoChange={onRepoChange}
        />
      )}

      {activeRepository?.kind === "submodule" && (
        <SubmoduleActions
          repository={activeRepository}
          actionLoading={submoduleActionLoading}
          onInit={onInitSubmodule}
          onUpdate={onUpdateSubmodule}
          onSync={onSyncSubmodule}
        />
      )}

      <div className="px-4 py-3 border-b border-[var(--border-color)] flex items-center justify-between flex-shrink-0 bg-[var(--color-surface-sunken)]">
        <div className="flex items-center space-x-2">
          <span className="font-bold text-[var(--text-light)] uppercase tracking-wider text-[10px] font-mono">
            Source Control
          </span>
          {isLoading && (
            <Loader2
              size={13}
              className="animate-spin text-[var(--accent-color)]"
              aria-label="Loading repository information"
            />
          )}
          <button
            type="button"
            onClick={onOpenGraph}
            className="p-1 rounded hover:bg-[var(--border-color)]/60 text-[var(--text-muted)] hover:text-[var(--text-light)] transition-colors cursor-pointer"
            title="Open Commit Graph"
          >
            <GitCommit size={13} className="text-[var(--accent-color)]" />
          </button>
        </div>

        {gitStatus && (
          <div className="flex items-center space-x-1.5 relative">
            {gitStatus.pendingOperation && (
              <button
                type="button"
                onClick={onAbortPending}
                className="p-1 rounded hover:bg-[var(--color-status-danger-bg)] text-[var(--text-muted)] hover:text-[var(--color-status-danger)] transition-colors cursor-pointer"
                title="Abort Merge/Rebase"
              >
                <RotateCcw size={12} />
              </button>
            )}

            <BranchWidget
              gitStatus={gitStatus}
              headLabel={headLabel}
              disableBranchOnlyActions={disableBranchOnlyActions}
              branchOnlyActionsReason={branchOnlyActionsReason}
              localBranches={localBranches}
              remoteBranches={remoteBranches}
              showBranchPopover={showBranchPopover}
              onTogglePopover={onToggleBranchPopover}
              onCheckout={onCheckoutBranch}
              onCreateBranch={onCreateBranch}
              onDeleteBranch={onDeleteBranch}
              onMergeBranch={onMergeBranch}
              onRebaseBranch={onRebaseBranch}
              onClosePopover={onCloseBranchPopover}
            />
          </div>
        )}
      </div>
    </>
  );
};

export default SourceControlHeader;
