/**
 * SidePane.tsx
 *
 * Inspector / chat side pane displayed alongside the Rusty canvas when a node
 * is selected. Provides tabs for describing the node, viewing diffs, chatting
 * with the agent, monitoring console output, and browsing the VFS.
 *
 * Architecture:
 * - The component is a pure orchestrator: it fetches store state via custom
 *   hooks, wires side-effects, and delegates rendering to sub-components.
 * - All side-effect logic (VFS sync, width persistence, keybindings, tab
 *   defaults) lives in extracted hooks under `./hooks/`.
 * - The complex WebSocket-driven explorer hook remains in `useExplorerWebSocket`.
 * - The footer (execute/stop) is extracted to `SidePaneFooter`.
 *
 * External consumers:
 * - `RustyTab.tsx` imports `{ SidePane }` and renders it when a node that
 *   supports a side pane is selected.
 */

import React, { useState, useCallback, useEffect } from "react";
import { useWorkspaceStore } from "../../../../store";

// Hooks
import { useResizable } from "./useResizable";
import { useDiffContent } from "./useDiffContent";
import { useExplorerWebSocket } from "./useExplorerWebSocket";
import {
  useSidePaneState,
  useNodeUsage,
  useVfsFileSync,
  useWidthSync,
  useEscapeClose,
  useActiveTabDefault,
  useActiveDiffFile,
  type SidePaneTab,
} from "../../sidepane/hooks";

// Sub-components
import { SidePaneHeader } from "./components/SidePaneHeader";
import { SidePaneRail } from "./components/SidePaneRail";
import { SidePaneFooter } from "./components/SidePaneFooter";

import { ResizeHandle } from "./ResizeHandle";
import { TabContent } from "./TabContent";

// Services
import { canvasFileService } from "../../services/canvasFileService";
import { notify } from "../../../notifications";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface SidePaneProps {
  /** Called when the pane should close (e.g. Escape key or close button). */
  onClose: () => void;
  /** Called when the user clicks the execute button on a task node. */
  onExecuteNode: (
    nodeId: string,
    customPrompt?: string,
    attachments?: { path: string; name: string; isDir?: boolean }[]
  ) => void;
  /** Called when the user clicks the stop button on a running task node. */
  onStopExecution: (nodeId: string) => void;
  /** The current canvas tab ID (used for VFS scoping). */
  tabId?: string;
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

/**
 * SidePane — inspector panel for the selected canvas node.
 *
 * Orchestrates store state selection, side-effects, and conditional rendering
 * of tab content. Each responsibility is extracted to a dedicated hook or
 * sub-component.
 */
export const SidePane: React.FC<SidePaneProps> = ({
  onClose,
  onExecuteNode,
  onStopExecution,
  tabId,
}) => {
  /* ---- Store-derived state ---- */
  const {
    selectedNodeId,
    selectedNode,
    nodeStatus,
    selectedChatMessageCount,
    customProviders,
    activeCustomProviderId,
    modifiedFiles,
    originalFileContents,
    generatedFileContents,
    storageKey,
  } = useSidePaneState();

  /* ---- Local UI state ---- */
  const [activeTab, setActiveTab] = useState<SidePaneTab>("chat");
  const [activeDiffFile, setActiveDiffFile] = useState<string>("");
  // Every node's pane now opens full-screen by default (a left icon rail
  // replaces the old horizontal tab strip that only made sense in a narrow
  // panel) -- a manual restore is still available per SidePaneHeader's
  // toggle, but picking a *different* node should land full-screen again
  // rather than remembering a previous restore, since SidePane stays
  // mounted across node selections (RustyTab.tsx renders it unkeyed).
  const [isMaximized, setIsMaximized] = useState(true);

  /* ---- Side-effects ---- */
  useVfsFileSync(tabId, selectedNodeId, selectedNode);
  useEscapeClose(onClose);
  useActiveTabDefault(selectedNode, setActiveTab);
  useActiveDiffFile(selectedNode, modifiedFiles, activeDiffFile, setActiveDiffFile);
  useEffect(() => {
    if (selectedNode) setIsMaximized(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedNode?.id]);

  /* ---- Resize / width hooks ---- */
  const { width, setWidth, containerRef, startResizing } = useResizable(
    500,
    storageKey
  );
  useWidthSync(storageKey, setWidth, containerRef);

  /* ---- Explorer WebSocket hook ---- */
  const explorer = useExplorerWebSocket(selectedNode);

  /* ---- Token usage ---- */
  const nodeUsage = useNodeUsage(selectedNodeId);

  /* ---- Diff content ---- */
  const { originalCode, modifiedCode, isLoading: isDiffLoading } =
    useDiffContent(
      selectedNodeId,
      activeDiffFile,
      nodeStatus,
      tabId,
      originalFileContents[activeDiffFile],
      generatedFileContents[activeDiffFile]
    );

  /* ---- Handlers ---- */
  const handleToggleMaximize = useCallback(() => {
    setIsMaximized((prev) => !prev);
  }, []);

  const handleGenerateTasksClick = useCallback(() => {
    setActiveTab("chat");
    explorer.handleOpenTaskGeneration();
  }, [explorer]);

  const handleTaskGenerationModelChange = useCallback(
    (model: string) => {
      if (!selectedNode) return;
      useWorkspaceStore
        .getState()
        .updateTaskNode(selectedNode.id, { taskGenerationModel: model });
    },
    [selectedNode]
  );

  const handleCreateTaskNodes = useCallback(
    async (tasks: any[], contexts: any[]) => {
      if (!tabId || !selectedNodeId) return;

      const created = useWorkspaceStore
        .getState()
        .addTaskNodesBatch(tabId, selectedNodeId, tasks, contexts);

      if (created.length > 0) {
        await canvasFileService.autoSaveCanvas(tabId);
        notify(
          "Generated Nodes Created",
          `Added ${created.length} task node${
            created.length === 1 ? "" : "s"
          }${
            contexts.length
              ? ` and ${contexts.length} code context node${
                  contexts.length === 1 ? "" : "s"
                }`
              : ""
          }.`,
          "success"
        );
      }
    },
    [tabId, selectedNodeId]
  );

  const handleExecuteNode = useCallback(() => {
    if (!selectedNode) return;
    onExecuteNode(selectedNode.id);
  }, [selectedNode, onExecuteNode]);

  const handleStopExecution = useCallback(() => {
    if (!selectedNode) return;
    onStopExecution(selectedNode.id);
  }, [selectedNode, onStopExecution]);

  /* ---- Early exit: nothing selected ---- */
  if (!selectedNode) return null;

  /* ---- Render ---- */
  return (
    <div
      ref={containerRef}
      style={{ width: isMaximized ? "100%" : `${width}px` }}
      className={`border-l border-[var(--border-color)] bg-[var(--bg-app)] flex flex-col h-full text-[var(--text-normal)] font-sans z-[40] max-w-full ${
        isMaximized ? "absolute inset-0" : "absolute right-0 top-0 bottom-0 shadow-2xl"
      }`}
    >
      {/* ---- Resize Handle ---- */}
      <ResizeHandle isMaximized={isMaximized} onMouseDown={startResizing} />

      {/* ---- Header/Content/Footer + Rail ---- */}
      <div className="flex-1 flex min-h-0 min-w-0">
        <div className="flex-1 flex flex-col min-w-0">
          {/* ---- Header ---- */}
          <SidePaneHeader
            selectedNode={selectedNode}
            onClose={onClose}
            isMaximized={isMaximized}
            onToggleMaximize={handleToggleMaximize}
            onGenerateTasks={handleGenerateTasksClick}
            onStopGenerateTasks={explorer.handleStopTaskGeneration}
            onSummarize={explorer.handleExplorerSummarize}
            isGeneratingTasks={explorer.isGeneratingTasks}
            isSummarizing={explorer.isSummarizing}
            disableGlobalActions={
              nodeStatus === "running" || selectedChatMessageCount === 0
            }
            taskGenerationModel={explorer.taskGenerationModel}
            taskGenerationModels={explorer.allAvailableModels}
            taskGenerationUnauthenticatedProviders={explorer.unauthenticatedProviders}
            onTaskGenerationModelChange={handleTaskGenerationModelChange}
          />

          {/* ---- Tab Content ---- */}
          <div className="flex-1 overflow-hidden relative bg-[var(--bg-app)]">
            <TabContent
              activeTab={activeTab}
              selectedNode={selectedNode}
              selectedNodeId={selectedNodeId}
              tabId={tabId}
              modifiedFiles={modifiedFiles}
              activeDiffFile={activeDiffFile}
              setActiveDiffFile={setActiveDiffFile}
              originalCode={originalCode}
              modifiedCode={modifiedCode}
              isDiffLoading={isDiffLoading}
              nodeStatus={nodeStatus}
              explorer={explorer}
              onCreateTaskNodes={handleCreateTaskNodes}
            />
          </div>

          {/* ---- Footer (task node only, not during chat) ---- */}
          {selectedNode.type === "taskNode" && activeTab !== "chat" && (
            <SidePaneFooter
              selectedNode={selectedNode}
              nodeStatus={nodeStatus}
              nodeUsage={nodeUsage}
              customProviders={customProviders}
              activeCustomProviderId={activeCustomProviderId}
              onExecute={handleExecuteNode}
              onStop={handleStopExecution}
            />
          )}
        </div>

        {/* ---- Section Rail ---- */}
        <SidePaneRail
          selectedNode={selectedNode}
          activeTab={activeTab}
          setActiveTab={setActiveTab}
          nodeStatus={nodeStatus}
        />
      </div>
    </div>
  );
};

/* ------------------------------------------------------------------ */
/*  Sub-Components (extracted for clarity)                             */
/* ------------------------------------------------------------------ */




