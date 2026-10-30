import { addEdge, applyEdgeChanges, applyNodeChanges } from "@xyflow/react";
import { createEmptyCanvasContext, findTabIdByEdgeId, getActiveCanvasTabId, getOrCreateContext, MAX_CANVAS_HISTORY, updateContextAndSync } from "../model/canvasHelpers";
import type { WorkspaceSliceCreator } from "../../../store/sliceTypes";

export const graphSlice: WorkspaceSliceCreator = (set, get) => ({
  onNodesChange: (changes) => set((state) => {
    const tabId = getActiveCanvasTabId(state);
    const structural = changes.some((change: any) => change.type === "add" || change.type === "remove");
    return updateContextAndSync(state, tabId, (context) => ({
      nodes: applyNodeChanges(changes, context.nodes),
      ...(!structural ? { isPipelineApplied: context.isPipelineApplied } : {}),
    }));
  }),
  onEdgesChange: (changes) => set((state) => {
    const tabId = getActiveCanvasTabId(state);
    const structural = changes.some((change: any) => change.type === "add" || change.type === "remove");
    return updateContextAndSync(state, tabId, (context) => ({
      edges: applyEdgeChanges(changes, context.edges),
      ...(!structural ? { isPipelineApplied: context.isPipelineApplied } : {}),
    }));
  }),
  onConnect: (connection) => set((state) => {
    const tabId = getActiveCanvasTabId(state);
    const style = connection.source?.startsWith("context")
      ? { stroke: "var(--color-status-success-solid)", strokeWidth: 2 }
      : undefined;
    return updateContextAndSync(state, tabId, (context) => ({
      edges: addEdge({ ...connection, style }, context.edges),
    }));
  }),
  onNodesChangeForTab: (tabId, changes) => set((state) => {
    const structural = changes.some((change: any) => change.type === "add" || change.type === "remove");
    return updateContextAndSync(state, tabId, (context) => ({
      nodes: applyNodeChanges(changes, context.nodes),
      ...(!structural ? { isPipelineApplied: context.isPipelineApplied } : {}),
    }), structural);
  }),
  onEdgesChangeForTab: (tabId, changes) => set((state) => {
    const structural = changes.some((change: any) => change.type === "add" || change.type === "remove");
    return updateContextAndSync(state, tabId, (context) => ({
      edges: applyEdgeChanges(changes, context.edges),
      ...(!structural ? { isPipelineApplied: context.isPipelineApplied } : {}),
    }), structural);
  }),
  onConnectForTab: (tabId, connection) => set((state) => {
    const isContext = connection.source?.startsWith("context");
    const isMcp = connection.source?.startsWith("mcp");
    const style = isContext
      ? { stroke: "var(--color-status-success-solid)", strokeWidth: 2 }
      : isMcp
        ? { stroke: "var(--color-status-info-solid)", strokeWidth: 2 }
        : undefined;
    return updateContextAndSync(state, tabId, (context) => ({
      edges: addEdge({ ...connection, style }, context.edges),
    }), true);
  }),
  updateCanvasContext: (tabId, updates) => set((state) =>
    updateContextAndSync(state, tabId, () => updates),
  ),
  undoCanvasTab: (tabId) => set((state) => {
    const history = state.canvasHistories?.[tabId] || { past: [], future: [] };
    if (history.past.length === 0) return {};
    const snapshot = history.past[history.past.length - 1];
    const context = getOrCreateContext(state, tabId);
    const future = [{ nodes: context.nodes, edges: context.edges }, ...history.future];
    if (future.length > MAX_CANVAS_HISTORY) future.pop();
    const canvasContexts = {
      ...state.canvasContexts,
      [tabId]: { ...context, nodes: snapshot.nodes, edges: snapshot.edges },
    };
    const canvasHistories = {
      ...state.canvasHistories,
      [tabId]: { past: history.past.slice(0, -1), future },
    };
    const activeContext = canvasContexts[getActiveCanvasTabId({ ...state, canvasContexts })]
      || createEmptyCanvasContext();
    return {
      canvasContexts,
      canvasHistories,
      nodes: activeContext.nodes,
      edges: activeContext.edges,
      nodeLogs: activeContext.nodeLogs,
      nodeStatus: activeContext.nodeStatus,
      globalChatHistory: activeContext.globalChatHistory,
      edgeReconciliationStatus: activeContext.edgeReconciliationStatus,
    };
  }),
  redoCanvasTab: (tabId) => set((state) => {
    const history = state.canvasHistories?.[tabId] || { past: [], future: [] };
    if (history.future.length === 0) return {};
    const snapshot = history.future[0];
    const context = getOrCreateContext(state, tabId);
    const past = [...history.past, { nodes: context.nodes, edges: context.edges }];
    if (past.length > MAX_CANVAS_HISTORY) past.shift();
    const canvasContexts = {
      ...state.canvasContexts,
      [tabId]: { ...context, nodes: snapshot.nodes, edges: snapshot.edges },
    };
    const canvasHistories = {
      ...state.canvasHistories,
      [tabId]: { past, future: history.future.slice(1) },
    };
    const activeContext = canvasContexts[getActiveCanvasTabId({ ...state, canvasContexts })]
      || createEmptyCanvasContext();
    return {
      canvasContexts,
      canvasHistories,
      nodes: activeContext.nodes,
      edges: activeContext.edges,
      nodeLogs: activeContext.nodeLogs,
      nodeStatus: activeContext.nodeStatus,
      globalChatHistory: activeContext.globalChatHistory,
      edgeReconciliationStatus: activeContext.edgeReconciliationStatus,
    };
  }),
  loadCanvasTab: (data) => {
    // A saved canvas carries its own id, which is also its tab identity --
    // see canvasTabIdentity for why that is deliberately unprefixed.
    const existedBefore = data.id ? get().tabs.some((tab) => tab.id === data.id) : false;
    const tabId = get().openTab({
      type: "canvas",
      canvasId: data.id,
      title: data.title || "Untitled Pipeline",
    });

    set((state) => {
      const canvasContexts = {
        ...state.canvasContexts,
        [tabId]: {
          nodes: data.nodes || [],
          edges: data.edges || [],
          nodeLogs: data.nodeLogs || {},
          nodeStatus: data.nodeStatus || {},
          globalChatHistory: data.globalChatHistory || {},
          edgeReconciliationStatus: data.edgeReconciliationStatus || {},
          reconciliationSnapshot: data.reconciliationSnapshot,
          isPipelineApplied: data.isPipelineApplied || false,
          contextNodesHidden: data.contextNodesHidden ?? false,
          contextRevealedTasks: data.contextRevealedTasks ?? [],
          // Freshly loaded from disk, so it is already saved. Re-loading a
          // canvas that is already open must not clobber unsaved edits.
          ...(!existedBefore ? { hasBeenSaved: true } : {}),
        },
      };
      const activeContext = canvasContexts[tabId];
      return {
        canvasContexts,
        nodes: activeContext.nodes,
        edges: activeContext.edges,
        nodeLogs: activeContext.nodeLogs,
        nodeStatus: activeContext.nodeStatus,
        globalChatHistory: activeContext.globalChatHistory,
        edgeReconciliationStatus: activeContext.edgeReconciliationStatus,
      };
    });

    return tabId;
  },
  setEdgeStatus: (edgeId, status) => set((state) => {
    const tabId = findTabIdByEdgeId(state, edgeId);
    return updateContextAndSync(state, tabId, (context) => ({
      edgeReconciliationStatus: { ...context.edgeReconciliationStatus, [edgeId]: status },
    }));
  }),
  getSequenceEdges: () => {
    const state = get();
    const context = state.canvasContexts[getActiveCanvasTabId(state)] || { edges: [] };
    return context.edges.filter((edge) =>
      edge.sourceHandle === "task-out" && edge.targetHandle === "task-in",
    );
  },
});
