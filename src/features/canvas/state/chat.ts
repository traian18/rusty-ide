import { findTabIdByNodeId, updateContextAndSync } from "../model/canvasHelpers";
import type { WorkspaceSliceCreator } from "../../../store/sliceTypes";

export const chatSlice: WorkspaceSliceCreator = (set, get) => ({
  addGlobalChatMessage: (nodeId, message) => set((state) => {
    const tabId = findTabIdByNodeId(state, nodeId);
    return updateContextAndSync(state, tabId, (context) => ({
      globalChatHistory: {
        ...context.globalChatHistory,
        [nodeId]: [...(context.globalChatHistory[nodeId] || []), message],
      },
    }));
  }),
  updateGlobalChatMessage: (nodeId, messageId, content) => set((state) => {
    const tabId = findTabIdByNodeId(state, nodeId);
    return updateContextAndSync(state, tabId, (context) => ({
      globalChatHistory: {
        ...context.globalChatHistory,
        [nodeId]: (context.globalChatHistory[nodeId] || []).map((message) =>
          message.id === messageId ? { ...message, content } : message,
        ),
      },
    }));
  }),
  clearGlobalChatHistory: (nodeId) => set((state) => {
    const tabId = findTabIdByNodeId(state, nodeId);
    return updateContextAndSync(state, tabId, (context) => ({
      globalChatHistory: { ...context.globalChatHistory, [nodeId]: [] },
    }));
  }),
  getGlobalChatHistory: (nodeId) => {
    const state = get();
    const context = state.canvasContexts[findTabIdByNodeId(state, nodeId)];
    return context?.globalChatHistory[nodeId] || [];
  },
});
