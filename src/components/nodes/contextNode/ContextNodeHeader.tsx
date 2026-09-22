/**
 * ContextNodeHeader — title bar for the ContextNode.
 *
 * Renders:
 * - An Info icon (styled green to match the "context" identity).
 * - The node name as text (or an inline input when editing).
 * - Action buttons: Search (when no file is attached), Rename, Delete.
 * - While editing: a save (Check) button replaces the action group.
 *
 * All interactive elements use `stopNodePropagation` to prevent React
 * Flow from intercepting pointer events inside a draggable node.
 */

import React from "react";
import { Info, Pencil, Check, Trash2, Search, Upload } from "lucide-react";
import { stopNodePropagation } from "../globalChat/stopPropagation";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface ContextNodeHeaderProps {
  /** Current display name of the node. */
  name: string | undefined;
  /** Whether the name-input is active. */
  isEditing: boolean;
  /** Temporary name value while editing. */
  tempName: string;
  /** Whether a file is attached (hides the Search button when true). */
  hasFilePath: boolean;
  /** Fired when the user types in the name input. */
  onTempNameChange: (value: string) => void;
  /** Fired when the user saves the edited name. */
  onNameSave: () => void;
  /** Fired when the user cancels editing (reverts to stored name). */
  onCancelEdit: () => void;
  /** Fired to enter edit mode. */
  onStartEdit: () => void;
  /** Fired to open the file-search overlay. */
  onOpenSearch: () => void;
  /** Fired to browse any file on the computer. */
  onBrowseFile: () => void;
  /** Fired to delete the node. */
  onDelete: () => void;
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export const ContextNodeHeader: React.FC<ContextNodeHeaderProps> = ({
  name,
  isEditing,
  tempName,
  hasFilePath,
  onTempNameChange,
  onNameSave,
  onCancelEdit,
  onStartEdit,
  onOpenSearch,
  onBrowseFile,
  onDelete,
}) => {
  return (
    <div className="flex items-center justify-between border-b border-[var(--border-color)] bg-[var(--color-surface-sunken)] px-3 py-2 select-none cursor-move">
      {/* Left: Icon + Name */}
      <div className="flex items-center space-x-2 flex-1 mr-2 min-w-0">
        <Info
          size={14}
          className="text-[var(--color-status-success)] flex-shrink-0"
        />

        {isEditing ? (
          <input
            type="text"
            value={tempName}
            onChange={(e) => onTempNameChange(e.target.value)}
            onPointerDown={stopNodePropagation}
            onMouseDown={stopNodePropagation}
            onClick={stopNodePropagation}
            onKeyDown={(e) => {
              if (e.key === "Enter") onNameSave();
              if (e.key === "Escape") onCancelEdit();
            }}
            className="nodrag bg-[var(--bg-app)] border border-[var(--border-color)] rounded px-1.5 py-0.5 font-sans text-xs text-[var(--text-light)] focus:outline-none focus:border-[var(--border-active)] w-full"
            autoFocus
          />
        ) : (
          <span className="font-sans text-xs font-semibold text-[var(--text-light)] truncate">
            {name || ""}
          </span>
        )}
      </div>

      {/* Right: Action buttons */}
      <div className="flex items-center space-x-1.5 flex-shrink-0">
        {isEditing ? (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onNameSave();
            }}
            onPointerDown={stopNodePropagation}
            onMouseDown={stopNodePropagation}
            className="nodrag text-[var(--color-status-success)] hover:text-[var(--color-status-success)] p-0.5 rounded transition-colors cursor-pointer"
            title="Save name"
          >
            <Check size={13} />
          </button>
        ) : (
          <>
            {!hasFilePath && (
              <>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onBrowseFile();
                  }}
                  onPointerDown={stopNodePropagation}
                  onMouseDown={stopNodePropagation}
                  className="nodrag text-[var(--text-muted)] hover:text-[var(--color-status-success)] p-0.5 rounded transition-colors cursor-pointer"
                  title="Browse any file or folder from computer"
                >
                  <Upload size={12} />
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onOpenSearch();
                  }}
                  onPointerDown={stopNodePropagation}
                  onMouseDown={stopNodePropagation}
                  className="nodrag text-[var(--text-muted)] hover:text-[var(--color-status-success)] p-0.5 rounded transition-colors cursor-pointer"
                  title="Search workspace files"
                >
                  <Search size={12} />
                </button>
              </>
            )}
            <button
              onClick={(e) => {
                e.stopPropagation();
                onStartEdit();
              }}
              onPointerDown={stopNodePropagation}
              onMouseDown={stopNodePropagation}
              className="nodrag text-[var(--text-muted)] hover:text-[var(--text-light)] p-0.5 rounded transition-colors cursor-pointer"
              title="Rename node"
            >
              <Pencil size={12} />
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onDelete();
              }}
              onPointerDown={stopNodePropagation}
              onMouseDown={stopNodePropagation}
              className="nodrag text-[var(--text-muted)] hover:text-[var(--color-status-danger)] p-0.5 rounded transition-colors cursor-pointer"
              title="Delete node"
            >
              <Trash2 size={12} />
            </button>
          </>
        )}
      </div>
    </div>
  );
};
