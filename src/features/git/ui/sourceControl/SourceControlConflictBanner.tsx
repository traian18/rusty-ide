import React from "react";
import { Check, GitMerge } from "lucide-react";
import type { GitStatusResult } from "../../../../store/types";

interface SourceControlConflictBannerProps {
  gitStatus: GitStatusResult;
  onOpenConflicts: () => void;
  onComplete: () => Promise<void>;
  onAbort: () => Promise<void>;
}

const VERBS = { merge: "Merging", rebase: "Rebasing", "cherry-pick": "Cherry-picking", revert: "Reverting" };

const BUTTON = "px-2 py-0.5 rounded border border-[var(--border-color)] hover:border-[var(--border-active)] text-[var(--text-light)] font-mono text-[10px] font-bold cursor-pointer transition-colors";

/** Says a merge or rebase is unfinished and offers its next step, so closing the merge window loses nothing. */
export const SourceControlConflictBanner: React.FC<SourceControlConflictBannerProps> = ({ gitStatus, onOpenConflicts, onComplete, onAbort }) => {
  const operation = gitStatus.pendingOperation;
  const conflicts = gitStatus.conflicted.length;
  if (!operation && conflicts === 0) return null;
  const summary = conflicts === 0 ? "ready to finish" : `${conflicts} ${conflicts === 1 ? "conflict" : "conflicts"}`;

  return (
    <div
      role="status"
      className="px-4 py-2 border-b border-[var(--color-status-warning-border)] bg-[var(--color-status-warning-bg)] flex items-center gap-2 flex-shrink-0"
    >
      <GitMerge size={12} className="flex-shrink-0 text-[var(--color-status-warning)]" aria-hidden="true" />
      <span className="flex-1 min-w-0 truncate text-[var(--text-light)]">
        {operation ? `${VERBS[operation]}: ` : ""}{summary}
      </span>
      {conflicts > 0 ? (
        <button type="button" className={BUTTON} onClick={() => onOpenConflicts()}>Resolve</button>
      ) : (
        <button type="button" className={BUTTON} onClick={() => void onComplete()}>
          <Check size={10} className="inline mr-1" aria-hidden="true" />Finish
        </button>
      )}
      {operation && <button type="button" className={BUTTON} onClick={() => void onAbort()}>Abort</button>}
    </div>
  );
};
