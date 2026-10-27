import { harness } from "../../../../harness";
import { clearTodos, todosFor } from "../../../../harness/core/definitions/todoTool";
import { commandPermissionService } from "../../../../services/commandPermissionService";
import { useWorkspaceStore } from "../../../../store";
import { useWorkflowRunStore } from "../../behaviors/workflowRunStore";
import { cancelResponseFlush, releasePendingQuestions } from "../turn";
import { chatRuntime, disposeChatRuntime } from "./chatRuntime";
import { tabChatIds, useChatStore } from "./chatStore";

/** Opens a new chat in the tab and shows it. The tab's first chat takes the tab's id, so a tab
 * with one chat keys its messages, todos and grants as it always has. */
export function openChat(tabId: string): string {
  const chatId = tabChatIds(tabId).includes(tabId) ? `${tabId}_${crypto.randomUUID()}` : tabId;
  const store = useWorkspaceStore.getState();
  if (!store.agentChats[chatId]) store.clearAgentMessages(chatId);
  chatRuntime(chatId);
  useChatStore.getState().add(tabId, chatId, todosFor(chatId));
  return chatId;
}

/** The tab's shown chat, opening its first one when it has none. */
export function ensureChat(tabId: string): string {
  return useChatStore.getState().tabs[tabId]?.activeChatId ?? openChat(tabId);
}

/** Stops what the chat runs and releases what it holds outside its view: the backend session,
 * the "allow this session" command grants and its todos. Nothing is saved. */
function releaseChat(chatId: string) {
  const { state, activity } = chatRuntime(chatId);
  activity.cancelScheduledFlush();
  cancelResponseFlush(state);
  state.historySummaryJob?.abort();
  state.historySummaryJob = null;
  state.agentRun?.cancel();
  state.agentRun = null;
  if (state.activeWorkflowId) useWorkflowRunStore.getState().finish(state.activeWorkflowId, "cancelled", undefined, chatId);
  state.activeWorkflowId = null;
  state.isStreaming = false;
  releasePendingQuestions(state);
  void harness.releaseSession(chatId);
  commandPermissionService.clearSession(chatId);
  clearTodos(chatId);
}

/** Closes the chat: its run is cancelled, its messages and view go, and late events from its runs are dropped. */
export function disposeChat(chatId: string) {
  releaseChat(chatId);
  disposeChatRuntime(chatId);
  useWorkflowRunStore.getState().forgetChat(chatId);
  useChatStore.getState().remove(chatId);
  useWorkspaceStore.getState().removeAgentChat(chatId);
}

/** Closes every chat of the tab (the tab closed, or another workspace was opened). */
export function disposeTabChats(tabId: string) {
  for (const chatId of [...tabChatIds(tabId)]) disposeChat(chatId);
}
