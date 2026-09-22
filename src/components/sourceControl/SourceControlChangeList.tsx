import React from "react";
import {
  Plus,
  Minus,
  RotateCcw,
  EyeOff,
} from "lucide-react";
import type { GitFileStatus } from "../git/GitActions";
import type { GitStatusResult } from "../../store/types";
import { getStatusIndicator, getRelativeDirectory } from "./sourceControlHelpers";

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────

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

interface SectionHeaderProps {
  label: string;
  count: number;
  /** Optional action button rendered on the right side of the header. */
  action?: React.ReactNode;
}

interface SourceControlChangeListProps {
  gitStatus: GitStatusResult;
  activeRepo: string;
  modifiedList: GitFileStatus[];
  untrackedList: GitFileStatus[];
  totalChanges: number;
  onStageFile: (e: React.MouseEvent, filePath: string) => Promise<void>;
  onUnstageFile: (e: React.MouseEvent, filePath: string) => Promise<void>;
  onDiscardChanges: (e: React.MouseEvent, filePath: string, fileName: string) => Promise<void>;
  onDiscardAllChanges: () => Promise<void>;
  onAddToGitignore: (filePath: string) => Promise<void>;
  onUndoRename: () => Promise<void>;
  onOpenFileDiff: (filePath: string, fileName: string, diffType: "staged" | "unstaged") => void;
  onFileContextMenu: (e: React.MouseEvent, file: GitFileStatus) => void;
}

// ─────────────────────────────────────────────────────────────
// Sub-Components
// ─────────────────────────────────────────────────────────────

/**
 * A labelled pill header with an optional action element.
 */
const SectionHeader: React.FC<SectionHeaderProps> = ({ label, count, action }) => {
  return (
    <div className="px-2 py-1 flex items-center justify-between text-[10px] font-mono font-bold text-[var(--text-muted)] uppercase tracking-wider">
      <div className="flex items-center space-x-1.5">
        <span>{label}</span>
        <span className="bg-[var(--border-color)] px-1.5 py-0.2 rounded-full text-[9px] text-[var(--text-normal)]">
          {count}
        </span>
      </div>
      {action}
    </div>
  );
};

/**
 * A single file row, showing the file name, relative directory,
 * status indicator, and contextual action buttons.
 */
const FileRow: React.FC<FileRowProps> = ({
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
            className="opacity-0 group-hover:opacity-100 p-1 text-[var(--text-muted)] hover:text-[var(--color-status-info)] hover:bg-[var(--color-surface-sunken)] rounded transition-all cursor-pointer"
            title="Undo rename/move"
          >
            <RotateCcw size={11} />
          </button>
        )}

        {/* Discard button */}
        {showDiscardButton && (
          <button
            onClick={handleDiscard}
            className="opacity-0 group-hover:opacity-100 p-1 text-[var(--text-muted)] hover:text-[var(--color-status-warning)] hover:bg-[var(--color-surface-sunken)] rounded transition-all cursor-pointer"
            title="Discard changes"
          >
            <RotateCcw size={11} />
          </button>
        )}

        {/* Gitignore button */}
        {showGitignoreButton && (
          <button
            onClick={handleGitignore}
            className="opacity-0 group-hover:opacity-100 p-1 text-[var(--text-muted)] hover:text-[var(--color-status-info)] hover:bg-[var(--color-surface-sunken)] rounded transition-all cursor-pointer"
            title="Add to .gitignore"
          >
            <EyeOff size={11} />
          </button>
        )}

        {/* Unstage button */}
        {showUnstageButton && (
          <button
            onClick={handleUnstage}
            className="opacity-0 group-hover:opacity-100 p-1 text-[var(--text-muted)] hover:text-[var(--color-status-danger)] hover:bg-[var(--color-surface-sunken)] rounded transition-all cursor-pointer"
            title="Unstage changes"
          >
            <Minus size={11} />
          </button>
        )}

        {/* Stage button */}
        {showStageButton && (
          <button
            onClick={handleStage}
            className="opacity-0 group-hover:opacity-100 p-1 text-[var(--text-muted)] hover:text-[var(--color-status-success)] hover:bg-[var(--color-surface-sunken)] rounded transition-all cursor-pointer"
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

/**
 * Renders the three file-change sections (staged, unstaged
 * modified/deleted/renamed, and untracked) inside a scrollable
 * container.
 */
const SourceControlChangeList: React.FC<SourceControlChangeListProps> = ({
  gitStatus,
  activeRepo,
  modifiedList,
  untrackedList,
  totalChanges,
  onStageFile,
  onUnstageFile,
  onDiscardChanges,
  onDiscardAllChanges,
  onAddToGitignore,
  onUndoRename,
  onOpenFileDiff,
  onFileContextMenu,
}) => {
  return (
    <div className="flex-1 overflow-y-auto p-2 space-y-4">
      {/* 1. Staged Changes */}
      {gitStatus.staged.length > 0 && (
        <div className="space-y-1">
          <SectionHeader label="Staged Changes" count={gitStatus.staged.length} />
          <div className="space-y-0.5">
            {gitStatus.staged.map((file) => (
              <FileRow
                key={`staged-${file.path}`}
                file={file}
                repoPath={activeRepo}
                showUnstageButton
                diffType="staged"
                isClickable
                onUnstage={onUnstageFile}
                onOpenDiff={onOpenFileDiff}
              />
            ))}
          </div>
        </div>
      )}

      {/* 2. Unstaged (modified / deleted / renamed) Changes */}
      {modifiedList.length > 0 && (
        <div className="space-y-1">
          <SectionHeader
            label="Changes"
            count={modifiedList.length}
            action={
              <button
                type="button"
                onClick={onDiscardAllChanges}
                className="p-1 rounded hover:bg-[var(--color-status-danger-bg)] text-[var(--text-muted)] hover:text-[var(--color-status-danger)] transition-colors cursor-pointer"
                title="Discard All Unstaged Changes"
              >
                <RotateCcw size={12} />
              </button>
            }
          />
          <div className="space-y-0.5">
            {modifiedList.map((file) => {
              const isRenamed = file.status_type === "renamed";
              return (
                <FileRow
                  key={`unstaged-${file.path}`}
                  file={file}
                  repoPath={activeRepo}
                  showStageButton={!isRenamed}
                  showDiscardButton={!isRenamed}
                  showUndoRenameButton={isRenamed}
                  diffType="unstaged"
                  isClickable={!isRenamed}
                  onStage={onStageFile}
                  onDiscard={onDiscardChanges}
                  onUndoRename={onUndoRename}
                  onOpenDiff={onOpenFileDiff}
                  onContextMenu={onFileContextMenu}
                />
              );
            })}
          </div>
        </div>
      )}

      {/* 3. Untracked Files */}
      {untrackedList.length > 0 && (
        <div className="space-y-1">
          <SectionHeader label="Untracked" count={untrackedList.length} />
          <div className="space-y-0.5">
            {untrackedList.map((file) => (
              <FileRow
                key={`untracked-${file.path}`}
                file={file}
                repoPath={activeRepo}
                showStageButton
                showGitignoreButton
                diffType="unstaged"
                isClickable
                onStage={onStageFile}
                onGitignore={onAddToGitignore}
                onOpenDiff={onOpenFileDiff}
                onContextMenu={onFileContextMenu}
              />
            ))}
          </div>
        </div>
      )}

      {/* 4. Empty / Clean state — only when there truly are zero changes */}
      {totalChanges === 0 && (
        <div className="flex flex-col items-center justify-center p-6 h-20 text-center text-[var(--text-muted)] font-mono text-[10px] space-y-1">
          <span>// No modifications detected.</span>
          <span>Working directory is clean.</span>
        </div>
      )}
    </div>
  );
};

export default SourceControlChangeList;
