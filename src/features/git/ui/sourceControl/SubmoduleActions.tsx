import React from "react";
import type { GitRepository } from "../../../../store/types";
import { Boxes, Download, RefreshCw } from "lucide-react";

export type SubmoduleActionKind = "init" | "update" | "sync";

export interface SubmoduleActionsProps {
  repository: GitRepository;
  actionLoading: SubmoduleActionKind | null;
  onInit: () => void;
  onUpdate: () => void;
  onSync: () => void;
}

/**
 * Init/update/sync actions for the active repository, shown only when it's
 * a discovered `kind: "submodule"` entry (REFACTOR_PLAN.md PR 5b commit
 * 23). Gitlink staging needs no button here -- a submodule's changed
 * checked-out commit already shows up as a modified path in the *parent*
 * repository's own change list, staged with the existing stage-file action
 * there (PR 5a #13's design decision).
 */
export const SubmoduleActions: React.FC<SubmoduleActionsProps> = ({ repository, actionLoading, onInit, onUpdate, onSync }) => {
  const state = repository.submoduleState;
  const dirtyLabel = state
    ? [
        state.changedGitlink && "gitlink changed",
        state.modifiedWorktree && "modified",
        state.untrackedContent && "untracked",
      ].filter(Boolean).join(", ") || "clean"
    : null;

  return (
    <div className="px-4 py-2 border-b border-[var(--border-color)]/60 bg-[var(--color-surface-sunken)] flex items-center justify-between flex-shrink-0 flex-wrap gap-y-1">
      <span className="flex items-center space-x-1.5 text-[9px] font-mono text-[var(--text-muted)] uppercase font-semibold">
        <Boxes size={11} className="text-[var(--accent-color)]" />
        <span>Submodule{repository.initialized ? "" : " (uninitialized)"}{dirtyLabel ? `: ${dirtyLabel}` : ""}</span>
      </span>
      <div className="flex items-center space-x-1.5">
        {!repository.initialized && (
          <button
            type="button"
            onClick={onInit}
            disabled={actionLoading !== null}
            className="px-2 py-0.5 rounded border border-[var(--border-color)] hover:border-[var(--border-active)] text-[10px] font-mono text-[var(--text-normal)] disabled:opacity-50 cursor-pointer"
            title="Register the submodule locally without cloning it"
          >
            {actionLoading === "init" ? "Initializing…" : "Initialize"}
          </button>
        )}
        <button
          type="button"
          onClick={onUpdate}
          disabled={actionLoading !== null}
          className="flex items-center space-x-1 px-2 py-0.5 rounded border border-[var(--border-color)] hover:border-[var(--border-active)] text-[10px] font-mono text-[var(--text-normal)] disabled:opacity-50 cursor-pointer"
          title={repository.initialized ? "Clone/checkout the commit recorded by the parent" : "Clone and checkout this submodule"}
        >
          <Download size={10} />
          <span>{actionLoading === "update" ? "Updating…" : repository.initialized ? "Update" : "Clone"}</span>
        </button>
        {repository.initialized && (
          <button
            type="button"
            onClick={onSync}
            disabled={actionLoading !== null}
            className="flex items-center space-x-1 px-2 py-0.5 rounded border border-[var(--border-color)] hover:border-[var(--border-active)] text-[10px] font-mono text-[var(--text-normal)] disabled:opacity-50 cursor-pointer"
            title="Sync the submodule's local URL from .gitmodules"
          >
            <RefreshCw size={10} />
            <span>{actionLoading === "sync" ? "Syncing…" : "Sync"}</span>
          </button>
        )}
      </div>
    </div>
  );
};
