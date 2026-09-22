/**
 * RustyTabToolbar.tsx
 *
 * Top-right toolbar for the Rusty canvas. Contains:
 * - Global Chat Node navigation button
 * - Hide Context Nodes toggle button
 * - Boundary navigation dropdown
 * - Add Node dropdown (task, context, MCP, sticky, boundary, global chat)
 * - Pipeline Actions dropdown (reconcile, save, apply)
 *
 * The toolbar manages its own dropdown open/close state and registers a
 * global click listener to close menus when clicking outside.
 */

import React, { useState, useEffect, useRef } from "react";
import {
  CheckSquare,
  Plus,
  ChevronDown,
  Folder,
  Globe,
  GitMerge,
  Save,
  Settings,
  Square,
  StickyNote,
  Plug,
  Eye,
  EyeOff,
} from "lucide-react";
import type { Node, ReactFlowInstance } from "@xyflow/react";
import { focusCanvasNode } from "../../../../services/canvasNodeNavigation";
import { getCanvasCenter } from "../helpers/canvasHelpers";

/** Props for the main toolbar component. */
interface RustyTabToolbarProps {
  tabId: string;
  boundaryNodes: Node[];
  globalChatNode: Node | undefined;
  hasGlobalChatNode: boolean;
  isReconciliationRunning: boolean;
  isPipelineApplied: boolean;
  rfInstance: ReactFlowInstance | null;
  contextNodesHidden: boolean;
  onToggleContextNodesHidden: () => void;
  /** Called when a node creation action should be dispatched. */
  onAddTaskNode: (x: number, y: number) => void;
  onAddContextNode: (x: number, y: number) => void;
  onAddMcpNode: (x: number, y: number) => void;
  onAddStickyNode: (x: number, y: number) => void;
  onAddBoundaryNode: (x: number, y: number) => void;
  onAddGlobalChatNode: (x: number, y: number) => void;
  onReconcileCode: () => void;
  onSavePipeline: () => void;
  onApplyChanges: () => void;
}

export const RustyTabToolbar: React.FC<RustyTabToolbarProps> = ({
  tabId,
  boundaryNodes,
  globalChatNode,
  hasGlobalChatNode,
  isReconciliationRunning,
  isPipelineApplied,
  rfInstance,
  contextNodesHidden,
  onToggleContextNodesHidden,
  onAddTaskNode,
  onAddContextNode,
  onAddMcpNode,
  onAddStickyNode,
  onAddBoundaryNode,
  onAddGlobalChatNode,
  onReconcileCode,
  onSavePipeline,
  onApplyChanges,
}) => {
  // Centralised dropdown state for the toolbar
  const [boundaryMenuOpen, setBoundaryMenuOpen] = useState(false);
  const [nodeMenuOpen, setNodeMenuOpen] = useState(false);
  const [actionMenuOpen, setActionMenuOpen] = useState(false);

  const toolbarRef = useRef<HTMLDivElement>(null);

  // Close all dropdowns when a click occurs outside the toolbar
  useEffect(() => {
    const handleGlobalClick = (e: MouseEvent) => {
      if (toolbarRef.current && e.target instanceof Node && !toolbarRef.current.contains(e.target)) {
        setBoundaryMenuOpen(false);
        setNodeMenuOpen(false);
        setActionMenuOpen(false);
      }
    };
    window.addEventListener("click", handleGlobalClick);
    return () => window.removeEventListener("click", handleGlobalClick);
  }, []);

  return (
    <div ref={toolbarRef} className="absolute top-4 right-4 z-10 flex items-center space-x-2">
      {/* Global Chat Node navigation */}
      <GlobalChatNavButton
        tabId={tabId}
        globalChatNode={globalChatNode}
        hasGlobalChatNode={hasGlobalChatNode}
      />

      {/* Hide Context Nodes toggle */}
      <HideContextNodesButton
        hidden={contextNodesHidden}
        onToggle={onToggleContextNodesHidden}
      />

      {/* Boundary navigation */}
      <BoundaryNavMenu
        tabId={tabId}
        boundaryNodes={boundaryNodes}
        isOpen={boundaryMenuOpen}
        onToggle={() => {
          setBoundaryMenuOpen((prev) => !prev);
          setNodeMenuOpen(false);
          setActionMenuOpen(false);
        }}
        onClose={() => setBoundaryMenuOpen(false)}
      />

      {/* Add Node Dropdown */}
      <AddNodeMenu
        tabId={tabId}
        hasGlobalChatNode={hasGlobalChatNode}
        rfInstance={rfInstance}
        isOpen={nodeMenuOpen}
        onToggle={() => {
          setNodeMenuOpen((prev) => !prev);
          setBoundaryMenuOpen(false);
          setActionMenuOpen(false);
        }}
        onClose={() => setNodeMenuOpen(false)}
        onAddTaskNode={onAddTaskNode}
        onAddContextNode={onAddContextNode}
        onAddMcpNode={onAddMcpNode}
        onAddStickyNode={onAddStickyNode}
        onAddBoundaryNode={onAddBoundaryNode}
        onAddGlobalChatNode={onAddGlobalChatNode}
      />

      {/* Pipeline Actions Dropdown */}
      <ActionMenu
        isOpen={actionMenuOpen}
        isReconciliationRunning={isReconciliationRunning}
        isPipelineApplied={isPipelineApplied}
        onToggle={() => {
          setActionMenuOpen((prev) => !prev);
          setBoundaryMenuOpen(false);
          setNodeMenuOpen(false);
        }}
        onClose={() => setActionMenuOpen(false)}
        onReconcileCode={onReconcileCode}
        onSavePipeline={onSavePipeline}
        onApplyChanges={onApplyChanges}
      />
    </div>
  );
};

/* ------------------------------------------------------------------ */
/*  Global Chat Nav Button                                             */
/* ------------------------------------------------------------------ */

/** Button that jumps to the Global Chat Node. */
const GlobalChatNavButton: React.FC<{
  tabId: string;
  globalChatNode: Node | undefined;
  hasGlobalChatNode: boolean;
}> = ({ tabId, globalChatNode, hasGlobalChatNode }) => (
  <button
    type="button"
    onClick={(event) => {
      event.stopPropagation();
      if (globalChatNode) focusCanvasNode(tabId, globalChatNode.id);
    }}
    disabled={!globalChatNode}
    title={
      hasGlobalChatNode
        ? `Jump to ${String(globalChatNode?.data?.name || "Global Chat")}`
        : "No Global Chat Node in this Rusty"
    }
    className="bg-[var(--bg-sidebar)] border border-[var(--border-color)] hover:bg-[var(--bg-header)] disabled:opacity-40 disabled:cursor-not-allowed text-[var(--text-light)] text-xs font-mono font-semibold px-3 py-1.5 rounded-lg flex items-center space-x-1.5 transition-all shadow-md hover:border-[var(--border-active)] cursor-pointer nodrag"
  >
    <Globe size={14} className="text-[var(--color-status-warning)]" />
    <span>Jump to Global Node</span>
  </button>
);

/* ------------------------------------------------------------------ */
/*  Hide Context Nodes Button                                          */
/* ------------------------------------------------------------------ */

/** Toggle button to hide/show all context nodes on the canvas. */
const HideContextNodesButton: React.FC<{
  hidden: boolean;
  onToggle: () => void;
}> = ({ hidden, onToggle }) => (
  <button
    type="button"
    onClick={(event) => {
      event.stopPropagation();
      onToggle();
    }}
    title={
      hidden
        ? "Show context nodes"
        : "Hide context nodes"
    }
    className={`bg-[var(--bg-sidebar)] border ${
      hidden
        ? "border-[var(--accent-color)] text-[var(--accent-color)]"
        : "border-[var(--border-color)] text-[var(--text-light)]"
    } hover:bg-[var(--bg-header)] text-xs font-mono font-semibold px-3 py-1.5 rounded-lg flex items-center space-x-1.5 transition-all shadow-md hover:border-[var(--border-active)] cursor-pointer nodrag`}
  >
    {hidden ? (
      <EyeOff size={14} className="text-[var(--accent-color)]" />
    ) : (
      <Eye size={14} className="text-[var(--text-muted)]" />
    )}
    <span>{hidden ? "Hidden" : "Context"}</span>
  </button>
);

/* ------------------------------------------------------------------ */
/*  Boundary Navigation Menu                                           */
/* ------------------------------------------------------------------ */

interface BoundaryNavMenuProps {
  tabId: string;
  boundaryNodes: Node[];
  isOpen: boolean;
  onToggle: () => void;
  onClose: () => void;
}

/** Dropdown menu for navigating to boundary nodes. */
const BoundaryNavMenu: React.FC<BoundaryNavMenuProps> = ({
  tabId,
  boundaryNodes,
  isOpen,
  onToggle,
  onClose,
}) => {
  const handleSelect = (boundaryId: string) => {
    focusCanvasNode(tabId, boundaryId);
    onClose();
  };

  return (
    <div className="relative">
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          if (boundaryNodes.length > 0) onToggle();
        }}
        disabled={boundaryNodes.length === 0}
        title={
          boundaryNodes.length > 0
            ? "Jump to a boundary"
            : "No boundaries in this Rusty"
        }
        className="bg-[var(--bg-sidebar)] border border-[var(--border-color)] hover:bg-[var(--bg-header)] disabled:opacity-40 disabled:cursor-not-allowed text-[var(--text-light)] text-xs font-mono font-semibold px-3 py-1.5 rounded-lg flex items-center space-x-1.5 transition-all shadow-md hover:border-[var(--border-active)] cursor-pointer nodrag"
      >
        <Square size={14} className="text-[var(--color-secondary)]" />
        <span>Boundaries</span>
        <ChevronDown size={12} className="text-[var(--text-muted)]" />
      </button>
      {isOpen && (
        <div
          className="absolute right-0 mt-1 w-56 max-h-64 overflow-y-auto bg-[var(--bg-sidebar)] border border-[var(--border-color)] rounded-lg shadow-xl py-1 z-20 font-mono text-xs"
          onClick={(e) => e.stopPropagation()}
        >
          {boundaryNodes.map((boundary, index) => (
            <button
              key={boundary.id}
              type="button"
              onClick={() => handleSelect(boundary.id)}
              className="w-full text-left px-3 py-2 hover:bg-[var(--accent-bg)] hover:text-[var(--text-light)] text-[var(--text-normal)] transition-colors cursor-pointer flex items-center space-x-2"
              title={String(boundary.data?.name || `Boundary ${index + 1}`)}
            >
              <Square size={13} className="text-[var(--color-secondary)] flex-shrink-0" />
              <span className="truncate">
                {String(boundary.data?.name || `Boundary ${index + 1}`)}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

/* ------------------------------------------------------------------ */
/*  Add Node Menu                                                      */
/* ------------------------------------------------------------------ */

interface AddNodeMenuProps {
  tabId: string;
  hasGlobalChatNode: boolean;
  rfInstance: ReactFlowInstance | null;
  isOpen: boolean;
  onToggle: () => void;
  onClose: () => void;
  onAddTaskNode: (x: number, y: number) => void;
  onAddContextNode: (x: number, y: number) => void;
  onAddMcpNode: (x: number, y: number) => void;
  onAddStickyNode: (x: number, y: number) => void;
  onAddBoundaryNode: (x: number, y: number) => void;
  onAddGlobalChatNode: (x: number, y: number) => void;
}

/** Dropdown menu for adding new nodes to the canvas. */
const AddNodeMenu: React.FC<AddNodeMenuProps> = ({
  tabId,
  hasGlobalChatNode,
  rfInstance,
  isOpen,
  onToggle,
  onClose,
  onAddTaskNode,
  onAddContextNode,
  onAddMcpNode,
  onAddStickyNode,
  onAddBoundaryNode,
  onAddGlobalChatNode,
}) => {
  const centerWithOffset = (offsetX: number, offsetY: number) => {
    const center = getCanvasCenter(rfInstance, tabId);
    return { x: center.x + offsetX, y: center.y + offsetY };
  };

  const handleAdd = (adder: (x: number, y: number) => void, offsetX: number, offsetY: number) => {
    const pos = centerWithOffset(offsetX, offsetY);
    adder(pos.x, pos.y);
    onClose();
  };

  return (
    <div className="relative">
      <button
        id="add-node-dropdown-btn"
        onClick={(e) => {
          e.stopPropagation();
          onToggle();
        }}
        className="bg-[var(--bg-sidebar)] border border-[var(--border-color)] hover:bg-[var(--bg-header)] text-[var(--text-light)] text-xs font-mono font-semibold px-3 py-1.5 rounded-lg flex items-center space-x-1.5 transition-all shadow-md hover:border-[var(--border-active)] cursor-pointer nodrag"
      >
        <Plus size={14} className="text-[var(--accent-color)]" />
        <span>Add Node</span>
        <ChevronDown size={12} className="text-[var(--text-muted)]" />
      </button>
      {isOpen && (
        <div
          className="absolute right-0 mt-1 w-44 bg-[var(--bg-sidebar)] border border-[var(--border-color)] rounded-lg shadow-xl py-1 z-20 font-mono text-xs"
          onClick={(e) => e.stopPropagation()}
        >
          <AddNodeMenuItem
            icon={<CheckSquare size={13} className="text-[var(--accent-color)]" />}
            label="Create Task Node"
            onClick={() => handleAdd(onAddTaskNode, -75, -30)}
          />
          <AddNodeMenuItem
            icon={<Folder size={13} className="text-[var(--color-status-success)]" />}
            label="Create Context Node"
            onClick={() => handleAdd(onAddContextNode, -75, -30)}
          />
          <AddNodeMenuItem
            icon={<Plug size={13} className="text-[var(--color-status-info)]" />}
            label="Create MCP Node"
            onClick={() => handleAdd(onAddMcpNode, -75, -30)}
          />
          <AddNodeMenuItem
            icon={<StickyNote size={13} className="text-[var(--color-status-warning)]" />}
            label="Create Sticky Note"
            onClick={() => handleAdd(onAddStickyNode, -100, -75)}
          />
          <AddNodeMenuItem
            icon={<Square size={13} className="text-[var(--color-status-danger)]" />}
            label="Create Boundary"
            onClick={() => handleAdd(onAddBoundaryNode, -150, -100)}
          />
          <div className="border-t border-[var(--border-color)] my-1" />
          <AddNodeMenuItem
            icon={<Globe size={13} className="text-[var(--color-status-danger)]" />}
            label={
              hasGlobalChatNode
                ? "Global Explorer already added"
                : "Create Global Explorer"
            }
            disabled={hasGlobalChatNode}
            title={
              hasGlobalChatNode
                ? "Only one Global Explorer can be added to a Rusty"
                : undefined
            }
            onClick={() => {
              if (!hasGlobalChatNode) {
                handleAdd(onAddGlobalChatNode, -75, -30);
              }
            }}
          />
        </div>
      )}
    </div>
  );
};

/** Single item inside the Add Node dropdown. */
const AddNodeMenuItem: React.FC<{
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

/* ------------------------------------------------------------------ */
/*  Action Menu                                                        */
/* ------------------------------------------------------------------ */

interface ActionMenuProps {
  isOpen: boolean;
  isReconciliationRunning: boolean;
  isPipelineApplied: boolean;
  onToggle: () => void;
  onClose: () => void;
  onReconcileCode: () => void;
  onSavePipeline: () => void;
  onApplyChanges: () => void;
}

/** Dropdown menu for pipeline-level actions (reconcile, save, apply). */
const ActionMenu: React.FC<ActionMenuProps> = ({
  isOpen,
  isReconciliationRunning,
  isPipelineApplied,
  onToggle,
  onClose,
  onReconcileCode,
  onSavePipeline,
  onApplyChanges,
}) => {
  const executeAction = (action: () => void) => {
    action();
    onClose();
  };

  return (
    <div className="relative">
      <button
        id="pipeline-actions-dropdown-btn"
        onClick={(e) => {
          e.stopPropagation();
          onToggle();
        }}
        className="bg-[var(--bg-sidebar)] border border-[var(--border-color)] hover:bg-[var(--bg-header)] text-[var(--text-light)] text-xs font-mono font-semibold px-3 py-1.5 rounded-lg flex items-center space-x-1.5 transition-all shadow-md hover:border-[var(--border-active)] cursor-pointer nodrag"
      >
        <Settings size={14} className="text-[var(--color-status-danger)]" />
        <span>Action</span>
        <ChevronDown size={12} className="text-[var(--text-muted)]" />
      </button>
      {isOpen && (
        <div
          className="absolute right-0 mt-1 w-48 bg-[var(--bg-sidebar)] border border-[var(--border-color)] rounded-lg shadow-xl py-1 z-20 font-mono text-xs"
          onClick={(e) => e.stopPropagation()}
        >
          <ActionMenuItem
            icon={<GitMerge size={13} className="text-[var(--color-status-danger)]" />}
            label="Reconcile Changes"
            onClick={() => executeAction(onReconcileCode)}
          />
          <ActionMenuItem
            icon={<Save size={13} className="text-[var(--color-status-success)]" />}
            label="Save Rusty"
            onClick={() => executeAction(onSavePipeline)}
          />
          <div className="border-t border-[var(--border-color)] my-1" />
          <ApplyRustyButton
            isReconciliationRunning={isReconciliationRunning}
            isPipelineApplied={isPipelineApplied}
            onClick={() => {
              if (!isReconciliationRunning) {
                executeAction(onApplyChanges);
              }
            }}
          />
        </div>
      )}
    </div>
  );
};

/** Single item inside the Action dropdown. */
const ActionMenuItem: React.FC<{
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}> = ({ icon, label, onClick }) => (
  <button
    onClick={onClick}
    className="w-full text-left px-3 py-2 hover:bg-[var(--accent-bg)] hover:text-[var(--text-light)] text-[var(--text-normal)] transition-colors cursor-pointer flex items-center space-x-2"
  >
    {icon}
    <span>{label}</span>
  </button>
);

/** The "Apply Rusty" button with context-dependent styling and text. */
const ApplyRustyButton: React.FC<{
  isReconciliationRunning: boolean;
  isPipelineApplied: boolean;
  onClick: () => void;
}> = ({ isReconciliationRunning, isPipelineApplied, onClick }) => {
  if (isReconciliationRunning) {
    return (
      <button
        disabled
        className="w-full text-left px-3 py-2 flex items-center space-x-2 text-[var(--color-status-warning)] cursor-not-allowed opacity-75 transition-colors"
      >
        <GitMerge size={13} className="text-[var(--color-status-warning)] animate-pulse" />
        <span>Reconciliation Running</span>
      </button>
    );
  }

  if (isPipelineApplied) {
    return (
      <button
        onClick={onClick}
        className="w-full text-left px-3 py-2 flex items-center space-x-2 hover:bg-[var(--accent-bg)] text-[var(--color-status-success)] cursor-pointer transition-colors"
      >
        <CheckSquare size={13} className="text-[var(--color-status-success)]" />
        <span>Apply Solution Again</span>
      </button>
    );
  }

  return (
    <button
      onClick={onClick}
      className="w-full text-left px-3 py-2 flex items-center space-x-2 hover:bg-[var(--accent-bg)] hover:text-[var(--text-light)] text-[var(--text-normal)] cursor-pointer transition-colors"
    >
      <CheckSquare size={13} className="text-[var(--accent-color)]" />
      <span>Apply Solution</span>
    </button>
  );
};
