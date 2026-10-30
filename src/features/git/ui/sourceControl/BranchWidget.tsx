import React from "react";
import { GitBranch, ChevronDown } from "lucide-react";
import type { GitStatusResult } from "../../../../store/types";
import { GitBranchManager } from "../GitBranchManager";

interface BranchWidgetProps {
  gitStatus: GitStatusResult;
  headLabel: string;
  disableBranchOnlyActions: boolean;
  branchOnlyActionsReason?: string;
  localBranches: string[];
  remoteBranches: string[];
  showBranchPopover: boolean;
  onTogglePopover: () => void;
  onCheckout: (branch: string) => Promise<void>;
  onCreateBranch: (branch: string) => Promise<void>;
  onDeleteBranch: (branch: string, force: boolean) => Promise<void>;
  onMergeBranch: (branch: string) => Promise<void>;
  onRebaseBranch: (branch: string) => Promise<void>;
  onClosePopover: () => void;
}

/**
 * The branch name pill that opens the Git branch manager popover,
 * plus the abort-merge/rebase button.
 */
export const BranchWidget: React.FC<BranchWidgetProps> = ({
  gitStatus,
  headLabel,
  disableBranchOnlyActions,
  branchOnlyActionsReason,
  localBranches,
  remoteBranches,
  showBranchPopover,
  onTogglePopover,
  onCheckout,
  onCreateBranch,
  onDeleteBranch,
  onMergeBranch,
  onRebaseBranch,
  onClosePopover,
}) => {
  return (
    <div className="flex items-center space-x-1.5 relative">
      <button
        type="button"
        onClick={onTogglePopover}
        className="flex items-center space-x-1 bg-[var(--accent-bg)]/35 text-[var(--accent-color)] px-2 py-1 rounded font-mono text-[10px] border border-[var(--accent-color)]/25 hover:border-[var(--accent-color)]/50 transition-all cursor-pointer font-bold"
        title={disableBranchOnlyActions ? branchOnlyActionsReason : undefined}
      >
        <GitBranch size={10} className="flex-shrink-0 mr-1" />
        <span className="truncate max-w-[80px]">{headLabel}</span>
        <ChevronDown size={10} className="flex-shrink-0 opacity-60 ml-0.5" />
      </button>

      {showBranchPopover && (
        <GitBranchManager
          currentBranch={gitStatus.currentBranch}
          disableBranchOnlyActions={disableBranchOnlyActions}
          branchOnlyActionsReason={branchOnlyActionsReason}
          localBranches={localBranches}
          remoteBranches={remoteBranches}
          onCheckout={onCheckout}
          onCreateBranch={onCreateBranch}
          onDeleteBranch={onDeleteBranch}
          onMergeBranch={onMergeBranch}
          onRebaseBranch={onRebaseBranch}
          onClose={onClosePopover}
        />
      )}
    </div>
  );
};

// ─────────────────────────────────────────────────────────────
// Main Component
// ─────────────────────────────────────────────────────────────
