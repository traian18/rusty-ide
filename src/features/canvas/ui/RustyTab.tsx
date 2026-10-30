import React from "react";
import { ReactFlow, Background, BackgroundVariant, ReactFlowProvider } from "@xyflow/react";
import { Maximize } from "lucide-react";
import { SidePane } from "./sidepane/SidePane";
import { CanvasTabContext } from "./CanvasTabContext";
import { RustyTabToolbar } from "./components/RustyTabToolbar";
import { RustyTabContextMenu } from "./components/RustyTabContextMenu";
import { RustyTabSaveModal } from "./components/RustyTabSaveModal";
import { useRustyTabContent, type RustyTabProps } from "./useRustyTab";
import { FloatingConnectButton } from "./FloatingConnectButton";
import { nodeTypes, edgeTypes } from "./canvasNodeTypes";

/**
 * Wraps the Rusty canvas content in a ReactFlowProvider so that
 * React Flow hooks (e.g., `useViewport`) are available to children.
 */
export const RustyTab: React.FC<RustyTabProps> = (props) => {
  return (
    <ReactFlowProvider>
      <RustyTabContent {...props} />
    </ReactFlowProvider>
  );
};

export const RustyTabContent: React.FC<RustyTabProps> = (props) => {
  const model = useRustyTabContent(props);
  const { tab, onExecuteNode, onStopExecution } = props;
  const {  edges, hasGlobalChatNode, setSelectedNodeId, storeActions, showSaveModal, setShowSaveModal, saveTitle, setSaveTitle, rfInstance, contextMenu, setContextMenu, contextNodesHidden, handleToggleContextNodesHidden, flowNodes, selectedNodes, boundaryNodes, globalChatNode, onNodesChange, onEdgesChange, onConnect, onConnectStart, onConnectEnd, onNodeClick, onEdgeClick, onPaneClick, onPaneContextMenu, onNodeContextMenu, onPaneDoubleClick, onDragOver, onDrop, onInit, possibleConnection, handleConnectSelected, handleIsValidConnection, handleSavePipeline, confirmSavePipeline, handleAddNodeFromContextMenu, showSidePane } = model;
  return (
    <CanvasTabContext.Provider value={{ tabId: tab.id }}>
      <div className="w-full h-full flex flex-row relative terminal-theme-tab">
        {/* ---- Canvas Area ---- */}
        <div
          className="flex-1 min-h-0 relative bg-[var(--bg-canvas)]"
          id={`rf-canvas-${tab.id}`}
          onDragOver={onDragOver}
        >
          {/* Toolbar */}
          <RustyTabToolbar
            tabId={tab.id}
            boundaryNodes={boundaryNodes}
            globalChatNode={globalChatNode}
            hasGlobalChatNode={hasGlobalChatNode}
            rfInstance={rfInstance}
            contextNodesHidden={contextNodesHidden}
            onToggleContextNodesHidden={handleToggleContextNodesHidden}
            onAddTaskNode={(x, y) => storeActions.addTaskNode(x, y, tab.id)}
            onAddContextNode={(x, y) =>
              storeActions.addContextNode(x, y, undefined, tab.id)
            }
            onAddMcpNode={(x, y) => storeActions.addMcpNode(x, y, tab.id)}
            onAddStickyNode={(x, y) => storeActions.addStickyNode(x, y, tab.id)}
            onAddBoundaryNode={(x, y) =>
              storeActions.addBoundaryNode(x, y, tab.id)
            }
            onAddGlobalChatNode={(x, y) =>
              storeActions.addGlobalChatNode(x, y, tab.id)
            }
            onSavePipeline={handleSavePipeline}
          />

          {/* Bottom Left Controls */}
          <div className="absolute bottom-4 left-4 z-10 flex items-center space-x-2">
            <button
              onClick={() => rfInstance?.fitView()}
              className="bg-[var(--bg-sidebar)]/80 border border-[var(--border-color)] hover:bg-[var(--bg-header)] text-[var(--text-normal)] text-xs font-mono font-bold px-3 py-1.5 rounded-lg flex items-center space-x-1.5 transition-all shadow-md cursor-pointer hover:border-[var(--border-active)]"
            >
              <Maximize size={13} className="text-[var(--accent-color)]" />
              <span>Center</span>
            </button>
          </div>

          {/* Context Menu */}
          {contextMenu && (
            <RustyTabContextMenu
              position={contextMenu}
              rfInstance={rfInstance}
              tabId={tab.id}
              hasGlobalChatNode={hasGlobalChatNode}
              onClose={() => setContextMenu(null)}
              onAddNode={handleAddNodeFromContextMenu}
              onAddMcpNode={(x, y) =>
                storeActions.addMcpNode(x, y, tab.id)
              }
              onAddGlobalChatNode={(x, y) =>
                storeActions.addGlobalChatNode(x, y, tab.id)
              }
            />
          )}

          {/* React Flow Board */}
          <div
            className="absolute inset-0"
            onDoubleClick={onPaneDoubleClick}
            onDragOver={onDragOver}
          >
            <ReactFlow
              style={{ width: "100%", height: "100%" }}
              nodes={flowNodes}
              edges={edges}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onConnect={onConnect}
              nodeTypes={nodeTypes}
              edgeTypes={edgeTypes}
              onNodeClick={onNodeClick}
              onEdgeClick={onEdgeClick}
              onPaneClick={onPaneClick}
              onPaneContextMenu={onPaneContextMenu}
              onNodeContextMenu={onNodeContextMenu}
              onInit={onInit}
              onDragOver={onDragOver}
              onDrop={onDrop}
              onConnectStart={onConnectStart}
              onConnectEnd={onConnectEnd}
              isValidConnection={handleIsValidConnection}
              proOptions={{ hideAttribution: true }}
              maxZoom={1.2}
              minZoom={0.2}
              elevateNodesOnSelect={false}
              multiSelectionKeyCode={["Meta", "Control"]}
            >
              <Background
                color="var(--color-border-default)"
                gap={16}
                size={1}
                variant={BackgroundVariant.Dots}
              />
            </ReactFlow>
          </div>

          {/* Floating Connect Button */}
          {possibleConnection && selectedNodes.length === 2 && (
            <FloatingConnectButton
              nodeA={selectedNodes[0]}
              nodeB={selectedNodes[1]}
              onConnect={handleConnectSelected}
            />
          )}
        </div>

        {/* ---- Side Panes ---- */}
        {showSidePane && (
          <SidePane
            onClose={() => setSelectedNodeId(null)}
            onExecuteNode={onExecuteNode}
            onStopExecution={onStopExecution}
            tabId={tab.id}
          />
        )}

        {/* Save Modal */}
        {showSaveModal && (
          <RustyTabSaveModal
            saveTitle={saveTitle}
            onTitleChange={setSaveTitle}
            onCancel={() => setShowSaveModal(false)}
            onConfirm={confirmSavePipeline}
          />
        )}
      </div>
    </CanvasTabContext.Provider>
  );
};
