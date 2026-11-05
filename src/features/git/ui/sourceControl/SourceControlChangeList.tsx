import React from "react";
import { RotateCcw } from "lucide-react";
import type { GitFileStatus } from "../../model";
import type { GitStatusResult } from "../../../../store/types";
import { SectionHeader } from "./SectionHeader";
import { FileRow } from "./FileRow";

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────


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
  onOpenConflicts: (filePath?: string) => void;
  onFileContextMenu: (e: React.MouseEvent, file: GitFileStatus) => void;
}

// ─────────────────────────────────────────────────────────────
// Sub-Components
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
  onOpenConflicts,
  onFileContextMenu,
}) => {
  return (
    <div className="flex-1 overflow-y-auto p-2 space-y-4">
      {/* 0. Merge Conflicts */}
      {gitStatus.conflicted.length > 0 && (
        <div className="space-y-1">
          <SectionHeader label="Merge Conflicts" count={gitStatus.conflicted.length} />
          <div className="space-y-0.5">
            {gitStatus.conflicted.map((file) => (
              <FileRow
                key={`conflicted-${file.path}`}
                file={file}
                repoPath={activeRepo}
                diffType="unstaged"
                isClickable
                onOpenDiff={onOpenConflicts}
              />
            ))}
          </div>
        </div>
      )}

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
