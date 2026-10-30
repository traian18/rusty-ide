import { createEmptyCanvasContext } from "../model/canvasHelpers";
import type { WorkspaceSliceCreator } from "../../../store/sliceTypes";

export const baseSlice: WorkspaceSliceCreator = (set) => ({
  nodes: [],
  edges: [],
  selectedNodeId: null,
  nodeLogs: {},
  nodeStatus: {},
  globalContextSummary: "",
  globalChatHistory: {},
  selectedEdgeId: null,
  edgeReconciliationStatus: {},
  canvasContexts: { canvas: createEmptyCanvasContext() },
  canvasHistories: { canvas: { past: [], future: [] } },
  setSelectedNodeId: (selectedNodeId) => set({ selectedNodeId }),
  setNodes: (nodes) => set({ nodes }),
  setEdges: (edges) => set({ edges }),
  setGlobalContextSummary: (globalContextSummary) => set({ globalContextSummary }),
  setSelectedEdgeId: (selectedEdgeId) => set({ selectedEdgeId }),
});
