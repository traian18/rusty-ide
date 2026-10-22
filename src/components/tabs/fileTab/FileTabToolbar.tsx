import React from "react";
import { Eye, FileCode2, GitBranch, History, TreePine } from "lucide-react";
import { useWorkspaceStore } from "../../../store";
import { CompareRevisionPicker } from "../../git/CompareRevisionPicker";
import type { FileTabData } from "./fileLocation";

const QUIET_BUTTON = "bg-[var(--bg-sidebar)] border border-[var(--border-color)] text-[var(--text-muted)] hover:text-[var(--text-light)] hover:border-[var(--border-active)]";
const PILL = "flex items-center space-x-1 px-2.5 py-1 rounded-md text-[10px] font-mono font-bold border transition-all shadow-md cursor-pointer";
const ICON_BUTTON = `${QUIET_BUTTON} p-1.5 rounded-md text-[10px] font-mono font-bold transition-all shadow-md cursor-pointer flex items-center space-x-1`;

interface FileTabToolbarProps {
  tab: FileTabData;
  repoPath: string;
  isMarkdown: boolean;
  markdownPreview: boolean;
  onToggleMarkdown: () => void;
  showBlame: boolean;
  onToggleBlame: () => void;
}

const VfsBadge: React.FC<{ vfsTabId: string }> = ({ vfsTabId }) => (
  <span
    className="flex items-center space-x-1 px-2 py-0.5 rounded-md text-[10px] font-mono font-bold bg-[var(--accent-bg)] border border-[var(--accent-color)]/40 text-[var(--accent-color)] shadow-sm"
    title={`Virtual File System Document (${vfsTabId})`}
  >
    <span>VFS</span>
  </span>
);

const MarkdownToggle: React.FC<{ preview: boolean; onToggle: () => void }> = ({ preview, onToggle }) => (
  <button
    onClick={onToggle}
    className={`${PILL} ${QUIET_BUTTON}`}
    title={preview ? "Edit Markdown source" : "Preview Markdown"}
  >
    {preview ? <FileCode2 size={10} /> : <Eye size={10} />}
    <span>{preview ? "Edit" : "Preview"}</span>
  </button>
);

/** History, compare, blame and reveal: only for files on disk. */
const DiskFileActions: React.FC<Pick<FileTabToolbarProps, "tab" | "repoPath" | "showBlame" | "onToggleBlame">> = ({ tab, repoPath, showBlame, onToggleBlame }) => {
  const openTab = useWorkspaceStore((state) => state.openTab);
  const revealFileInTree = useWorkspaceStore((state) => state.revealFileInTree);
  // Repo-scoped now: the identity carries the repository, so the same file
  // in two repositories no longer collides on one history tab. Passing
  // repoPath explicitly (found while auditing blame, PR 5b commit 19)
  // fixes a real bug: omitting it left the git-history policy default to
  // the workspace root regardless of which repository the file actually
  // lives in, so history for a file inside a submodule opened scoped to
  // the whole workspace instead.
  const openHistory = () => openTab({ type: "git-history", path: tab.path, repoPath: repoPath || undefined });
  const compare = (revision: string) => openTab({ type: "git-diff", repoPath, path: tab.path, diffType: "revision", commitHash: revision });

  return (
    <>
      <button onClick={openHistory} className={ICON_BUTTON} title="Open Git History of this File">
        <History size={10} />
        <span>History</span>
      </button>

      {/* Compare with another branch/revision */}
      {repoPath && <CompareRevisionPicker repoPath={repoPath} filePath={tab.path} onCompare={compare} />}

      <button
        onClick={onToggleBlame}
        className={`${PILL} ${
          showBlame
            ? "bg-[var(--accent-color)] border-[var(--accent-color)] text-[var(--color-primary-foreground)] font-semibold"
            : QUIET_BUTTON
        }`}
        title="Toggle Git Blame (or click line numbers)"
      >
        <GitBranch size={10} />
        <span>{showBlame ? "Blame: On" : "Blame"}</span>
      </button>

      <button onClick={() => revealFileInTree(tab.path)} className={ICON_BUTTON} title="Reveal in File Tree">
        <TreePine size={10} />
        <span>Reveal</span>
      </button>
    </>
  );
};

/** The file tab's floating action controls, top right. */
export const FileTabToolbar: React.FC<FileTabToolbarProps> = ({ tab, repoPath, isMarkdown, markdownPreview, onToggleMarkdown, showBlame, onToggleBlame }) => (
  <div className="absolute top-2.5 right-6 z-10 flex items-center space-x-2">
    {tab.vfsTabId && <VfsBadge vfsTabId={tab.vfsTabId} />}
    {isMarkdown && <MarkdownToggle preview={markdownPreview} onToggle={onToggleMarkdown} />}
    {!tab.vfsTabId && <DiskFileActions tab={tab} repoPath={repoPath} showBlame={showBlame} onToggleBlame={onToggleBlame} />}
  </div>
);
