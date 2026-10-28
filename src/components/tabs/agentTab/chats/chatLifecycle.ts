import { harness } from "../../../../harness";
import { clearTodos, todosFor } from "../../../../harness/core/definitions/todoTool";
import { commandPermissionService } from "../../../../services/commandPermissionService";
import { useWorkspaceStore } from "../../../../store";
import { useWorkflowRunStore } from "../../behaviors/workflowRunStore";
import { cancelResponseFlush, releasePendingQuestions } from "../turn";
import { chatRuntime, disposeChatRuntime } from "./chatRuntime";
import { tabChatIds, useChatStore } from "./chatStore";

/** Opens a new chat in the tab and shows it, after the others or at strip position `at`. The
 * tab's first chat takes the tab's id, so a tab with one chat keys its messages, todos and grants
 * as it always has. */
export function openChat(tabId: string, at?: number): string {
  const chatId = tabChatIds(tabId).includes(tabId) ? `${tabId}_${crypto.randomUUID()}` : tabId;
  const store = useWorkspaceStore.getState();
  if (!store.agentChats[chatId]) store.clearAgentMessages(chatId);
  chatRuntime(chatId);
  useChatStore.getState().add(tabId, chatId, todosFor(chatId), at);
  return chatId;
}

/**
 * Puts a fresh chat where `chatId` is in the strip and closes `chatId`. A chat is one
 * conversation: what its runtime holds (a Specs page run waiting to be sent, a goal, a spec queue,
 * a failed run's checkpoint, the earlier-turns summary) belongs to it and goes with it, so another
 * conversation never inherits it. Only the message box's draft moves over. The new chat.
 */
export function replaceChat(tabId: string, chatId: string): string {
  const draft = useChatStore.getState().chats[chatId]?.message ?? "";
  const at = tabChatIds(tabId).indexOf(chatId);
  const fresh = openChat(tabId, at < 0 ? undefined : at);
  if (draft) useChatStore.getState().patch(fresh, { message: draft });
  disposeChat(chatId);
  return fresh;
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
  if (state.continueTimer) clearTimeout(state.continueTimer);
  state.continueTimer = null;
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
