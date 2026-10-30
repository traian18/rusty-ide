import { findTabIdByNodeId, updateContextAndSync } from "../model/canvasHelpers";
import type { WorkspaceSliceCreator } from "../../../store/sliceTypes";

export const logsSlice: WorkspaceSliceCreator = (set) => ({
  addLog: (nodeId, message) => set((state) => {
    const tabId = findTabIdByNodeId(state, nodeId);
    return updateContextAndSync(state, tabId, (context) => ({
      nodeLogs: {
        ...context.nodeLogs,
        [nodeId]: [
          ...(context.nodeLogs[nodeId] || []),
          `[${new Date().toLocaleTimeString()}] ${message}`,
        ],
      },
    }));
  }),
  clearLogs: (nodeId) => set((state) => {
    const tabId = findTabIdByNodeId(state, nodeId);
    return updateContextAndSync(state, tabId, (context) => ({
      nodeLogs: { ...context.nodeLogs, [nodeId]: [] },
    }));
  }),
  setNodeStatus: (nodeId, status) => set((state) => {
    const tabId = findTabIdByNodeId(state, nodeId);
    return updateContextAndSync(state, tabId, (context) => ({
      nodeStatus: { ...context.nodeStatus, [nodeId]: status },
    }));
  }),
});
