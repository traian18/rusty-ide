/**
 * Header section of the GlobalChatNode.
 *
 * Displays the node name (editable inline), action buttons (rename, delete),
 * and a status indicator (spinner for running, checkmark for success, cross for error).
 */

import React from "react";
import {
  Pencil,
  Check,
  Trash2,
  Loader2,
  Sparkles,
  X,
  Lightbulb,
} from "lucide-react";
import type { NodeExecutionStatus } from "./statusBorderConfig";
import { stopNodePropagation } from "./stopPropagation";

interface GlobalChatNodeHeaderProps {
  /** Default fallback name when data.name is empty. */
  defaultName: string;
  /** The node's display name from store data. */
  name: string | undefined;
  /** Current execution status (drives the icon/indicator). */
  nodeStatus: NodeExecutionStatus;
  /** Whether the name input is being edited. */
  isEditing: boolean;
  /** Current value of the temporary name while editing. */
  tempName: string;
  /** Fired when the user changes the name input. */
  onTempNameChange: (value: string) => void;
  /** Fired when the user saves the name. */
  onNameSave: () => void;
  /** Fired when the user cancels name editing. */
  onCancelEdit: () => void;
  /** Fired to enter edit mode. */
  onStartEdit: () => void;
  /** Fired to delete the node. */
  onDelete: () => void;
}

export const GlobalChatNodeHeader: React.FC<GlobalChatNodeHeaderProps> = ({
  defaultName,
  name,
  nodeStatus,
  isEditing,
  tempName,
  onTempNameChange,
  onNameSave,
  onCancelEdit,
  onStartEdit,
  onDelete,
}) => {
  return (
    <div className="flex items-center justify-between border-b border-[var(--border-color)]/70 bg-[var(--color-surface-sunken)] px-3 py-2 select-none cursor-move flex-shrink-0">
      {/* Left: Icon + Name */}
      <div className="flex items-center space-x-2 flex-1 mr-2 min-w-0">
        <Lightbulb
          size={14}
          className={`text-[var(--color-status-warning)] flex-shrink-0 ${
            nodeStatus === "running" ? "animate-spin" : ""
          }`}
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
            className="nodrag bg-[var(--bg-app)] border border-[var(--border-color)] rounded px-1.5 py-0.5 font-sans text-xs text-[var(--text-light)] focus:outline-none focus:border-[var(--color-status-warning-border)] w-full"
            autoFocus
          />
        ) : (
          <span className="font-sans text-xs font-semibold text-[var(--text-light)] truncate">
            {name || defaultName}
          </span>
        )}
      </div>

      {/* Right: Action buttons + Status */}
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
          >
            <Check size={13} />
          </button>
        ) : (
          <>
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

        {/* Status indicator */}
        <div className="flex-shrink-0 pl-1">
          {nodeStatus === "running" && (
            <Loader2
              size={14}
              className="text-[var(--color-status-danger)] animate-spin"
            />
          )}
          {nodeStatus === "success" && (
            <Sparkles size={14} className="text-[var(--color-status-success)]" />
          )}
          {nodeStatus === "error" && (
            <X size={14} className="text-[var(--color-status-danger)]" />
          )}
        </div>
      </div>
    </div>
  );
};
