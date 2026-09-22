import React from "react";
import { AlertCircle, GitBranch } from "lucide-react";

// ─────────────────────────────────────────────────────────────
// Empty States
// ─────────────────────────────────────────────────────────────

/**
 * Shown when no folder is open in the workspace.
 */
export const NoFolderEmptyState: React.FC = () => {
  return (
    <div className="flex flex-col items-center justify-center p-6 h-full text-center text-[var(--text-muted)] font-mono text-xs select-none">
      <AlertCircle size={20} className="text-[var(--color-status-warning)] mb-2" />
      <span>Open a folder first to view Source Control</span>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────

interface NoGitRepoEmptyStateProps {
  /** Whether the initialisation command is currently running. */
  initLoading: boolean;
  /** Called when the user clicks "Initialize Repository". */
  onInitialize: () => void;
}

/**
 * Shown when the workspace folder is open but is not a Git
 * repository yet.
 */
export const NoGitRepoEmptyState: React.FC<NoGitRepoEmptyStateProps> = ({
  initLoading,
  onInitialize,
}) => {
  return (
    <div className="flex flex-col items-center justify-center p-6 h-full text-center space-y-4 select-none">
      <div className="flex flex-col items-center text-[var(--text-muted)] font-mono text-xs space-y-2">
        <GitBranch size={24} className="text-[var(--text-muted)] animate-pulse" />
        <span className="font-semibold text-[var(--text-normal)]">
          No Git Repository Found
        </span>
        <span className="text-[10px] max-w-[200px] leading-relaxed">
          Initialize git source control to track modifications and commit code
          changes.
        </span>
      </div>
      <button
        onClick={onInitialize}
        disabled={initLoading}
        className="w-full bg-[var(--accent-color)] hover:bg-[var(--accent-color)]/85 disabled:bg-[var(--border-color)] text-[var(--color-primary-foreground)] text-xs font-mono font-bold py-2 rounded-lg transition-all shadow-md cursor-pointer flex items-center justify-center"
      >
        {initLoading ? "Initializing..." : "Initialize Repository"}
      </button>
    </div>
  );
};
