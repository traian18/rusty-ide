/**
 * ContextNodeContent — the body section of the ContextNode.
 *
 * Two main areas:
 * 1. **Attached file / folder** — shows the attached context file with its
 *    name, path, type icon, and a clear (X) button. When no file is attached,
 *    renders a dashed drop-zone.
 * 2. **Description textarea** — free-form text notes with an expand/minimize
 *    toggle.
 *
 * The component manages its own textarea ref for auto-resize behaviour.
 */

import React, { useRef, useEffect } from "react";
import { Folder, X, Upload } from "lucide-react";
import { FileIcon } from "../../../services/fileTypeService";
import { stopNodePropagation } from "../globalChat/stopPropagation";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface ContextNodeContentProps {
  /** Absolute path of the attached file, if any. */
  path: string | undefined;
  /** Display name of the attached file. */
  fileName: string | undefined;
  /** Whether the attached entry is a directory. */
  isDir: boolean | undefined;
  /** Current description text. */
  description: string | undefined;
  /** Whether the description area is minimized. */
  isMinimized: boolean;
  /** Fired when the user clicks the attached file/folder. */
  onFileClick: (e: React.MouseEvent) => void;
  /** Fired to clear the attached context file. */
  onClearContext: (e: React.MouseEvent) => void;
  /** Fired to open native dialog to browse any file on the computer. */
  onBrowseFile: () => void;
  /** Fired to open native dialog to browse any folder on the computer. */
  onBrowseFolder: () => void;
  /** Fired when the description text changes. */
  onDescriptionChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;
  /** Fired to toggle minimize/expand. */
  onToggleMinimize: () => void;
}

/* ------------------------------------------------------------------ */
/*  MINIMIZED_HEIGHT                                                   */
/* ------------------------------------------------------------------ */

/** Height (px) of the textarea when minimized (roughly 3 rows). */
const MINIMIZED_HEIGHT = 60;

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export const ContextNodeContent: React.FC<ContextNodeContentProps> = ({
  path,
  fileName,
  isDir,
  description,
  isMinimized,
  onFileClick,
  onClearContext,
  onBrowseFile,
  onBrowseFolder,
  onDescriptionChange,
  onToggleMinimize,
}) => {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  /* ---- Auto-resize textarea to fit content ---- */
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;

    if (isMinimized) {
      el.style.height = `${MINIMIZED_HEIGHT}px`;
    } else {
      el.style.height = "auto";
      el.style.height = `${el.scrollHeight}px`;
    }
  }, [description, isMinimized]);

  const hasFileAttached = !!path;

  return (
    <div className="p-3 space-y-3">
      {/* ---- Attached File / Drop Zone ---- */}
      {hasFileAttached ? (
        <div
          onClick={onFileClick}
          className={`flex items-center justify-between bg-[var(--bg-app)] border border-[var(--border-color)] rounded-lg p-2.5 relative group ${
            !isDir
              ? "cursor-pointer hover:border-[var(--border-active)] hover:bg-[var(--bg-app)] transition-all"
              : ""
          }`}
        >
          <div className="flex items-center space-x-2.5 min-w-0">
            <span className="flex-shrink-0 text-[var(--color-status-success)]">
              {isDir ? (
                <Folder size={15} />
              ) : (
                <FileIcon fileName={fileName || ""} size={15} />
              )}
            </span>
            <div className="flex flex-col min-w-0">
              <span className="font-sans text-xs font-semibold text-[var(--text-light)] truncate">
                {fileName}
              </span>
              <span className="font-mono text-[9px] text-[var(--text-muted)] truncate max-w-[180px]">
                {path}
              </span>
            </div>
          </div>
          <button
            onClick={onClearContext}
            onPointerDown={stopNodePropagation}
            onMouseDown={stopNodePropagation}
            className="nodrag absolute right-2 top-2 text-[var(--text-muted)] hover:text-[var(--text-light)] opacity-0 group-hover:opacity-100 transition-opacity p-0.5 rounded cursor-pointer"
            title="Remove context file"
          >
            <X size={12} />
          </button>
        </div>
      ) : (
        <div
          onClick={onBrowseFile}
          onPointerDown={stopNodePropagation}
          className="border border-dashed border-[var(--border-color)] hover:border-[var(--color-status-success)] bg-[var(--bg-app)]/30 hover:bg-[var(--color-status-success-bg)]/20 rounded-lg py-3 px-2 text-center transition-all cursor-pointer group select-none"
        >
          <div className="flex flex-col items-center justify-center space-y-1.5">
            <Upload size={14} className="text-[var(--text-muted)] group-hover:text-[var(--color-status-success)] transition-colors" />
            <div className="text-[10px] font-sans text-[var(--text-muted)] group-hover:text-[var(--text-light)]">
              Browse any file or drop here
            </div>
            <div className="flex items-center space-x-1.5 pt-0.5">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onBrowseFile();
                }}
                onPointerDown={stopNodePropagation}
                onMouseDown={stopNodePropagation}
                className="nodrag text-[9px] px-2 py-0.5 rounded bg-[var(--bg-app)] border border-[var(--border-color)] hover:border-[var(--color-status-success)] text-[var(--text-normal)] hover:text-[var(--color-status-success)] transition-colors cursor-pointer"
              >
                Browse File
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onBrowseFolder();
                }}
                onPointerDown={stopNodePropagation}
                onMouseDown={stopNodePropagation}
                className="nodrag text-[9px] px-2 py-0.5 rounded bg-[var(--bg-app)] border border-[var(--border-color)] hover:border-[var(--color-status-success)] text-[var(--text-normal)] hover:text-[var(--color-status-success)] transition-colors cursor-pointer"
              >
                Browse Folder
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ---- Description Context ---- */}
      <div>
        <div className="flex items-center justify-between mb-1">
          <label className="block text-[9px] uppercase font-semibold text-[var(--text-muted)] font-sans">
            Description Context
          </label>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onToggleMinimize();
            }}
            onPointerDown={stopNodePropagation}
            onMouseDown={stopNodePropagation}
            className="nodrag text-[9px] font-sans text-[var(--text-muted)] hover:text-[var(--text-light)] transition-colors flex items-center space-x-1 cursor-pointer"
          >
            {isMinimized ? <span>[Expand]</span> : <span>[Minimize]</span>}
          </button>
        </div>
        <textarea
          ref={textareaRef}
          value={description || ""}
          onChange={onDescriptionChange}
          onPointerDown={stopNodePropagation}
          onMouseDown={stopNodePropagation}
          onClick={stopNodePropagation}
          placeholder="Type notes or additional text context..."
          className={`nodrag w-full bg-[var(--bg-app)] border border-[var(--border-color)] rounded-lg p-2 text-xs font-sans leading-relaxed text-[var(--text-light)] placeholder-[var(--text-muted)] focus:outline-none focus:border-[var(--border-active)] resize-none ${
            isMinimized ? "overflow-y-auto" : "overflow-hidden"
          }`}
          style={
            isMinimized
              ? { height: `${MINIMIZED_HEIGHT}px` }
              : { minHeight: "45px", height: "auto" }
          }
        />
      </div>
    </div>
  );
};
