/**
 * RustyTabContextMenu.tsx
 *
 * Floating context menu displayed on right-click on the canvas pane
 * (or on a boundary node). Provides quick access to node creation.
 */

import React from "react";
import { CheckSquare, Folder, Globe, Plug, Square, StickyNote } from "lucide-react";
import type { ReactFlowInstance } from "@xyflow/react";
import { screenToFlowPosition } from "../helpers/canvasHelpers";

/** Screen-space position where the menu should appear. */
export interface ContextMenuPosition {
  /** Position relative to the canvas container (for CSS positioning). */
  x: number;
  y: number;
  /** Absolute screen position (for flow coordinate conversion). */
  screenX: number;
  screenY: number;
}

interface RustyTabContextMenuProps {
  position: ContextMenuPosition;
  rfInstance: ReactFlowInstance | null;
  tabId: string;
  hasGlobalChatNode: boolean;
  onClose: () => void;
  onAddNode: (type: "task" | "context" | "sticky" | "boundary") => void;
  onAddMcpNode: (x: number, y: number) => void;
  onAddGlobalChatNode: (x: number, y: number) => void;
}

export const RustyTabContextMenu: React.FC<RustyTabContextMenuProps> = ({
  position,
  rfInstance,
  hasGlobalChatNode,
  onClose,
  onAddNode,
  onAddMcpNode,
  onAddGlobalChatNode,
}) => {
  // Convert screen position to flow position for MCP and Global Chat node creation
  const addMcpAtPosition = () => {
    const flowPos = screenToFlowPosition(rfInstance, position.screenX, position.screenY);
    if (flowPos) {
      onAddMcpNode(flowPos.x - 75, flowPos.y - 30);
    }
    onClose();
  };

  const addGlobalAtPosition = () => {
    if (hasGlobalChatNode) return;
    const flowPos = screenToFlowPosition(rfInstance, position.screenX, position.screenY);
    if (flowPos) {
      onAddGlobalChatNode(flowPos.x - 75, flowPos.y - 30);
    }
    onClose();
  };

  return (
    <div
      style={{ top: position.y, left: position.x }}
      className="absolute bg-[var(--bg-sidebar)] border border-[var(--border-color)] rounded-lg shadow-2xl py-1 z-30 font-mono text-xs w-48"
      onClick={(e) => e.stopPropagation()}
    >
      <ContextMenuItem
        icon={<CheckSquare size={13} className="text-[var(--accent-color)]" />}
        label="Add Task Node"
        onClick={() => {
          onAddNode("task");
          onClose();
        }}
      />
      <ContextMenuItem
        icon={<Folder size={13} className="text-[var(--color-status-success)]" />}
        label="Add Context Node"
        onClick={() => {
          onAddNode("context");
          onClose();
        }}
      />
      <ContextMenuItem
        icon={<Plug size={13} className="text-[var(--color-status-info)]" />}
        label="Add MCP Node"
        onClick={addMcpAtPosition}
      />
      <ContextMenuItem
        icon={<StickyNote size={13} className="text-[var(--color-status-warning)]" />}
        label="Add Sticky Note"
        onClick={() => {
          onAddNode("sticky");
          onClose();
        }}
      />
      <ContextMenuItem
        icon={<Square size={13} className="text-[var(--color-status-danger)]" />}
        label="Add Boundary"
        onClick={() => {
          onAddNode("boundary");
          onClose();
        }}
      />
      <div className="border-t border-[var(--border-color)] my-1" />
      <ContextMenuItem
        icon={<Globe size={13} className="text-[var(--color-status-danger)]" />}
        label={hasGlobalChatNode ? "Global Explorer already added" : "Add Global Explorer"}
        disabled={hasGlobalChatNode}
        title={
          hasGlobalChatNode
            ? "Only one Global Explorer can be added to a Rusty"
            : undefined
        }
        onClick={addGlobalAtPosition}
      />
    </div>
  );
};

/** Single item inside the context menu. */
const ContextMenuItem: React.FC<{
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  title?: string;
}> = ({ icon, label, onClick, disabled, title }) => (
  <button
    onClick={onClick}
    disabled={disabled}
    title={title}
    className={`w-full text-left px-3 py-2 text-[var(--text-normal)] transition-colors flex items-center space-x-2 ${
      disabled
        ? "cursor-not-allowed opacity-50"
        : "hover:bg-[var(--accent-bg)] hover:text-[var(--text-light)] cursor-pointer"
    }`}
  >
    {icon}
    <span>{label}</span>
  </button>
);
