import React from "react";
import { Plus, Minus, RotateCcw, EyeOff } from "lucide-react";
import type { GitFileStatus } from "../../model";
import { getStatusIndicator, getRelativeDirectory } from "../../sourceControlHelpers";

interface FileRowProps {
  file: GitFileStatus;
  repoPath: string;
  showStageButton?: boolean;
  showUnstageButton?: boolean;
  showDiscardButton?: boolean;
  showGitignoreButton?: boolean;
  showUndoRenameButton?: boolean;
  diffType: "staged" | "unstaged";
  isClickable?: boolean;
  onStage?: (e: React.MouseEvent, filePath: string) => Promise<void>;
  onUnstage?: (e: React.MouseEvent, filePath: string) => Promise<void>;
  onDiscard?: (e: React.MouseEvent, filePath: string, fileName: string) => Promise<void>;
  onGitignore?: (filePath: string) => Promise<void>;
  onUndoRename?: () => Promise<void>;
  onOpenDiff?: (filePath: string, fileName: string, diffType: "staged" | "unstaged") => void;
  onContextMenu?: (e: React.MouseEvent, file: GitFileStatus) => void;
}

/**
 * A single file row, showing the file name, relative directory,
 * status indicator, and contextual action buttons.
 */
export const FileRow: React.FC<FileRowProps> = ({
  file,
  repoPath,
  showStageButton = false,
  showUnstageButton = false,
  showDiscardButton = false,
  showGitignoreButton = false,
  showUndoRenameButton = false,
  diffType,
  isClickable = true,
  onStage,
  onUnstage,
  onDiscard,
  onGitignore,
  onUndoRename,
  onOpenDiff,
  onContextMenu,
}) => {
  const indicator = getStatusIndicator(file.status_type);
  const isRenamed = file.status_type === "renamed";
  const relativeDir = isRenamed
    ? ""
    : getRelativeDirectory(repoPath, file.path, file.name);

  /** Opens the diff view for this file. */
  const handleClick = (): void => {
    if (!isClickable || isRenamed) return;
    onOpenDiff?.(file.path, file.name, diffType);
  };

  /** Stages the file. */
  const handleStage = (e: React.MouseEvent): void => {
    e.stopPropagation();
    onStage?.(e, file.path);
  };

  /** Unstages the file. */
  const handleUnstage = (e: React.MouseEvent): void => {
    e.stopPropagation();
    onUnstage?.(e, file.path);
  };

  /** Discards changes in the file. */
  const handleDiscard = (e: React.MouseEvent): void => {
    e.stopPropagation();
    onDiscard?.(e, file.path, file.name);
  };

  /** Adds the file to .gitignore. */
  const handleGitignore = (e: React.MouseEvent): void => {
    e.stopPropagation();
    onGitignore?.(file.path);
  };

  /** Undoes the last rename / move. */
  const handleUndoRename = (e: React.MouseEvent): void => {
    e.stopPropagation();
    onUndoRename?.();
  };

  /** Opens the file context menu. */
  const handleContextMenu = (e: React.MouseEvent): void => {
    onContextMenu?.(e, file);
  };

  return (
    <div
      key={`${diffType}-${file.path}`}
      onClick={handleClick}
      onContextMenu={isClickable ? handleContextMenu : undefined}
      className="group flex items-center justify-between px-2.5 py-1.5 rounded hover:bg-[var(--accent-bg)]/20 cursor-pointer transition-colors"
    >
      <div className="flex flex-col min-w-0 flex-1">
        <span className="text-[var(--text-normal)] group-hover:text-[var(--text-light)] truncate font-mono text-[11px]">
          {file.name}
        </span>
        {relativeDir && (
          <span className="text-[9px] text-[var(--text-muted)] truncate select-none">
            {relativeDir}
          </span>
        )}
      </div>

      <div className="flex items-center space-x-1.5">
        {/* Undo rename button */}
        {showUndoRenameButton && (
          <button
            onClick={handleUndoRename}
            className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100 p-1 text-[var(--text-muted)] hover:text-[var(--color-status-info)] hover:bg-[var(--color-surface-sunken)] rounded transition-all cursor-pointer"
            title="Undo rename/move"
          >
            <RotateCcw size={11} />
          </button>
        )}

        {/* Discard button */}
        {showDiscardButton && (
          <button
            onClick={handleDiscard}
            className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100 p-1 text-[var(--text-muted)] hover:text-[var(--color-status-warning)] hover:bg-[var(--color-surface-sunken)] rounded transition-all cursor-pointer"
            title="Discard changes"
          >
            <RotateCcw size={11} />
          </button>
        )}

        {/* Gitignore button */}
        {showGitignoreButton && (
          <button
            onClick={handleGitignore}
            className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100 p-1 text-[var(--text-muted)] hover:text-[var(--color-status-info)] hover:bg-[var(--color-surface-sunken)] rounded transition-all cursor-pointer"
            title="Add to .gitignore"
          >
            <EyeOff size={11} />
          </button>
        )}

        {/* Unstage button */}
        {showUnstageButton && (
          <button
            onClick={handleUnstage}
            className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100 p-1 text-[var(--text-muted)] hover:text-[var(--color-status-danger)] hover:bg-[var(--color-surface-sunken)] rounded transition-all cursor-pointer"
            title="Unstage changes"
          >
            <Minus size={11} />
          </button>
        )}

        {/* Stage button */}
        {showStageButton && (
          <button
            onClick={handleStage}
            className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100 p-1 text-[var(--text-muted)] hover:text-[var(--color-status-success)] hover:bg-[var(--color-surface-sunken)] rounded transition-all cursor-pointer"
            title="Stage changes"
          >
            <Plus size={11} />
          </button>
        )}

        <span
          className={`w-4 text-center text-[10px] font-mono select-none ${indicator.colorClass}`}
        >
          {indicator.char}
        </span>
      </div>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────
// Main Component
// ─────────────────────────────────────────────────────────────
