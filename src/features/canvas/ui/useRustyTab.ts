import React, { useState, useCallback, useEffect, useRef, useMemo } from "react";
import type { TabOfType } from "../../../app/tabs/types";
import { useWorkspaceStore } from "../../../store";
import { canvasFileService } from "../services/canvasFileService";
import { getNodeConfig } from "../nodes/RustyNodeConfig";
import { buildFlowNodes } from "../helpers/canvasHelpers";
import { registerNodeFocusEffect } from "./canvasEffects";
import { registerUndoRedoShortcut } from "./canvasEffects";
import { useStoreActions } from "./useStoreActions";
import { useCanvasNodeCreation } from "./useCanvasNodeCreation";
import { useSavePipeline } from "./useSavePipeline";
import { useCanvasConnections } from "./useCanvasConnections";

export interface RustyTabProps {
  tab: TabOfType<"canvas">;
  onExecuteNode: (nodeId: string) => void;
  onStopExecution: (nodeId: string) => void;
}

/* ------------------------------------------------------------------ */
/*  Entry Point                                                        */
/* ------------------------------------------------------------------ */

export function useRustyTabContent(props: Pick<RustyTabProps, "tab">) {
  const { tab } = props;
  /* ---- Store state ---- */
  const context = useWorkspaceStore(
    (state) => state.canvasContexts[tab.id]
  ) || {
    nodes: [],
    edges: [],
    nodeStatus: {},
    edgeReconciliationStatus: {},
    isPipelineApplied: false,
  };

  const nodes = context.nodes || [];
  const edges = context.edges || [];
  const hasGlobalChatNode = nodes.some(
    (node: { type?: string }) => node.type === "globalChatNode"
  );

  const selectedNodeId = useWorkspaceStore((state) => state.selectedNodeId);
  const setSelectedNodeId = useWorkspaceStore((state) => state.setSelectedNodeId);
  const setSelectedEdgeId = useWorkspaceStore((state) => state.setSelectedEdgeId);
  const updateCanvasContext = useWorkspaceStore((state) => state.updateCanvasContext);

  /* ---- Store action creators ---- */
  const storeActions = useStoreActions();

  /* ---- Local state ---- */
  const {
    showSaveModal,
    setShowSaveModal,
    saveTitle,
    setSaveTitle,
    handleSavePipeline,
    confirmSavePipeline,
  } = useSavePipeline(tab);
  const [rfInstance, setRfInstance] = useState<any>(null);

  const initRef = useRef(false);

  /* ---- Context node visibility state ---- */
  const contextNodesHidden = context.contextNodesHidden ?? false;
  const contextRevealedTasks = context.contextRevealedTasks ?? [];

  /** Toggles context node visibility mode. */
  const handleToggleContextNodesHidden = useCallback(() => {
    updateCanvasContext(tab.id, { contextNodesHidden: !contextNodesHidden });
  }, [updateCanvasContext, tab.id, contextNodesHidden]);

  /* ---- Derived data ---- */
  const flowNodes = useMemo(() => {
    const built = buildFlowNodes(nodes);
    if (!contextNodesHidden) return built;
    // When context nodes are hidden, only keep context nodes that are
    // connected to a task in the revealed-tasks set.
    const revealedContextIds = new Set<string>();
    if (contextRevealedTasks.length > 0) {
      edges.forEach((edge: { source: string; target: string; targetHandle?: string | null }) => {
        if (
          contextRevealedTasks.includes(edge.target) &&
          edge.targetHandle?.startsWith("context-in")
        ) {
          revealedContextIds.add(edge.source);
        }
      });
    }
    return built.filter((node: { type?: string; id: string }) => {
      if (node.type === "contextNode" && !revealedContextIds.has(node.id)) {
        return false;
      }
      return true;
    });
  }, [nodes, edges, contextNodesHidden, contextRevealedTasks]);

  const selectedNodes = useMemo(
    () => flowNodes.filter((n: { selected?: boolean }) => n.selected),
    [flowNodes]
  );

  const {
    onConnect,
    onConnectStart,
    onConnectEnd,
    possibleConnection,
    handleConnectSelected,
    handleIsValidConnection,
  } = useCanvasConnections({ tabId: tab.id, nodes, edges, selectedNodes, rfInstance });

  const boundaryNodes = useMemo(
    () => nodes.filter((node: { type?: string }) => node.type === "boundaryNode"),
    [nodes]
  );

  const globalChatNode = useMemo(
    () => nodes.find((node: { type?: string }) => node.type === "globalChatNode"),
    [nodes]
  );

  /* ================================================================ */
  /*  React Flow Event Handlers                                        */
  /* ================================================================ */

  const onNodesChange = useCallback(
    (changes: any[]) => {
      useWorkspaceStore.getState().onNodesChangeForTab(tab.id, changes);
    },
    [tab.id]
  );

  const onEdgesChange = useCallback(
    (changes: any[]) => {
      useWorkspaceStore.getState().onEdgesChangeForTab(tab.id, changes);
    },
    [tab.id]
  );

  const onNodeClick = useCallback(
    (_event: React.MouseEvent, _node: any) => {
      setSelectedEdgeId(null);
    },
    [setSelectedEdgeId]
  );

  const onEdgeClick = useCallback(
    (_event: React.MouseEvent, edge: any) => {
      const currentSelectedId = useWorkspaceStore.getState().selectedNodeId;
      const selectedNodeInThisCanvas = nodes.find(
        (n: { id: string }) => n.id === currentSelectedId
      );
      if (
        !selectedNodeInThisCanvas ||
        selectedNodeInThisCanvas.type !== "globalChatNode"
      ) {
        setSelectedNodeId(null);
      }
      setSelectedEdgeId(edge.id);
    },
    [setSelectedNodeId, setSelectedEdgeId, nodes]
  );

  const {
    contextMenu,
    setContextMenu,
    onPaneContextMenu,
    onNodeContextMenu,
    onPaneDoubleClick,
    onDragOver,
    onDrop,
    handleAddNodeFromContextMenu,
  } = useCanvasNodeCreation({ tabId: tab.id, rfInstance, storeActions });

  const onPaneClick = useCallback(() => {
    setSelectedEdgeId(null);
    const currentSelectedId = useWorkspaceStore.getState().selectedNodeId;
    if (!currentSelectedId) {
      setContextMenu(null);
      return;
    }
    const selectedNodeInThisCanvas = nodes.find(
      (n: { id: string }) => n.id === currentSelectedId
    );
    if (!selectedNodeInThisCanvas) {
      setContextMenu(null);
      return;
    }
    if (selectedNodeInThisCanvas.type === "globalChatNode") {
      return;
    }
    setSelectedNodeId(null);
    setContextMenu(null);
  }, [setSelectedNodeId, setSelectedEdgeId, nodes]);

  const onInit = useCallback((instance: any) => {
    setRfInstance(instance);
    if (!initRef.current) {
      initRef.current = true;
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          instance.fitView({ maxZoom: 1.2 });
        });
      });
    }
  }, []);

  /* ================================================================ */
  /*  Business Logic Handlers                                          */
  /* ================================================================ */

  /* ================================================================ */
  /*  Effects                                                           */
  /* ================================================================ */

  /* ---- Handle canvas node focus events ---- */
  useEffect(() => {
    return registerNodeFocusEffect(tab.id, nodes, rfInstance);
  }, [nodes, rfInstance, tab.id]);

  /* ---- Global click closes context menu ---- */
  useEffect(() => {
    const handleGlobalClick = () => {
      setContextMenu(null);
    };
    window.addEventListener("click", handleGlobalClick);
    return () => window.removeEventListener("click", handleGlobalClick);
  }, []);

  /* ---- Auto-save on data changes ---- */
  useEffect(() => {
    if (!context.hasBeenSaved) return;

    const timer = setTimeout(() => {
      console.log(`[RustyTab] Auto-saving canvas tab: ${tab.id}`);
      canvasFileService.autoSaveCanvas(tab.id);
    }, 1500);

    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes, edges, context.globalChatHistory, context.hasBeenSaved, tab.id]);

  /* ---- Undo / Redo keyboard shortcuts ---- */
  useEffect(() => {
    return registerUndoRedoShortcut(tab.id);
  }, [tab.id]);

  /* ================================================================ */
  /*  Side Pane Visibility                                             */
  /* ================================================================ */

  const selectedNode = useMemo(
    () => flowNodes.find((n: { id: string }) => n.id === selectedNodeId),
    [flowNodes, selectedNodeId]
  );

  const showSidePane = useMemo(() => {
    if (!selectedNodeId || !selectedNode) return false;
    if (selectedNode.type === "globalChatNode") return true;
    return (
      selectedNodes.length === 1 &&
      selectedNodes[0].id === selectedNodeId &&
      getNodeConfig(selectedNode.type || "").hasSidepane
    );
  }, [selectedNodeId, selectedNode, selectedNodes]);

  /* ================================================================ */
  /*  Render                                                            */
  /* ================================================================ */


  return {
    context,
    nodes,
    edges,
    hasGlobalChatNode,
    selectedNodeId,
    setSelectedNodeId,
    setSelectedEdgeId,
    updateCanvasContext,
    storeActions,
    showSaveModal,
    setShowSaveModal,
    saveTitle,
    setSaveTitle,
    rfInstance,
    setRfInstance,
    contextMenu,
    setContextMenu,
    initRef,
    contextNodesHidden,
    contextRevealedTasks,
    handleToggleContextNodesHidden,
    flowNodes,
    selectedNodes,
    boundaryNodes,
    globalChatNode,
    onNodesChange,
    onEdgesChange,
    onConnect,
    onConnectStart,
    onConnectEnd,
    onNodeClick,
    onEdgeClick,
    onPaneClick,
    onPaneContextMenu,
    onNodeContextMenu,
    onPaneDoubleClick,
    onDragOver,
    onDrop,
    onInit,
    possibleConnection,
    handleConnectSelected,
    handleIsValidConnection,
    handleSavePipeline,
    confirmSavePipeline,
    handleAddNodeFromContextMenu,
    selectedNode,
    showSidePane,
  };
}
