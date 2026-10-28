import type React from "react";
import { invoke } from "@tauri-apps/api/core";
import type { WorkflowAnswer, WorkflowQuestion } from "../../../harness/contract";
import { useWorkspaceStore } from "../../../store";
import type { AgentQuestion } from "../../ui/ChatInput";
import { readSavedChat, type SavedChat } from "./savedChats";
import { readChatWorkflow } from "../../../services/agentChatPersistence";
import { workflowCatalogService } from "../../../services/workflowCatalogService";
import { BUILTIN_WORKFLOW_PATH } from "../behaviors/starterFlow";
import { adoptsBuiltinPath } from "./useWorkflowCatalog";
import { useWorkflowRunStore } from "../behaviors/workflowRunStore";
import { stopActiveSubagents } from "./subagents";
import { cancelResponseFlush, DEFAULT_STREAMING_LABEL, releasePendingQuestions, type AgentTurn } from "./turn";
import { disposeChat, disposeTabChats, openChat, replaceChat } from "./chats/chatLifecycle";
import { chatRuntime } from "./chats/chatRuntime";
import { chatView, isChatBusy, tabChatIds, useChatStore } from "./chats/chatStore";
import { chatSessionFor, chatTurn, type ChatTabContext } from "./chats/chatTurn";

/** Stops the run, keeping the user's request and every update shown so far. */
export function stopTurn(turn: AgentTurn) {
  const { state, ui } = turn;
  const workflowId = state.activeWorkflowId;
  state.agentRun?.cancel();
  state.agentRun = null;
  state.activeWorkflowId = null;
  state.activeWorkflowRunId = null;
  ui.setWorkflowRunning(false);
  if (workflowId) useWorkflowRunStore.getState().finish(workflowId, "cancelled", undefined, turn.chatId);
  turn.activity.flush();
  state.responseStream?.flush();
  state.responseStream = null;
  cancelResponseFlush(state);
  ui.setSubagents(stopActiveSubagents);
  state.isStreaming = false;
  ui.setIsStreaming(false);
  ui.setStreamingLabel(DEFAULT_STREAMING_LABEL);
  ui.setAgentQuestions([]);
  turn.chat.clearWorkflowQuestions();
  releasePendingQuestions(state);
  void turn.chat.save();
}

/** Stops every chat of the tab that is running (the close-intercept's "stop what this tab runs"). */
export function stopAllChats(context: ChatTabContext) {
  for (const chatId of tabChatIds(context.tab.id)) {
    if (isChatBusy(chatView(chatId))) stopTurn(chatTurn(context, chatId));
  }
}

/** Another workspace was opened: the tab starts over in it, with one empty chat and nothing of the previous one running or shown. */
export function resetForWorkspace(tabId: string) {
  disposeTabChats(tabId);
  openChat(tabId);
}

/** The tab closed: every chat's run stops and what it holds is released. */
export function closeTab(tabId: string) {
  disposeTabChats(tabId);
}

/** A chat with nothing in it, nothing running and nothing prepared (a Specs page run waiting to be
 * sent, a spec queue, a goal): a new chat or a loaded one may take its place. A prepared chat is a
 * conversation that has not started yet, so it stays and the other opens beside it. */
function isBlank(chatId: string): boolean {
  const { state } = chatRuntime(chatId);
  const prepared = Boolean(state.specRun || state.goal) || state.specQueue.length > 0;
  return !prepared && !isChatBusy(chatView(chatId)) && (useWorkspaceStore.getState().agentChats[chatId] || []).length === 0;
}

function activeChatId(tabId: string): string | undefined {
  return useChatStore.getState().tabs[tabId]?.activeChatId;
}

/** A fresh chat: in place of the shown one when that is blank (it is closed with everything its
 * runtime held), else beside it; any chat that runs goes on running. Never the same runtime for
 * another conversation. The chat to use. */
export function newChat(context: ChatTabContext): string {
  const tabId = context.tab.id;
  const current = activeChatId(tabId);
  return current && isBlank(current) ? replaceChat(tabId, current) : openChat(tabId);
}

/** Closes a chat from the strip; a running one is stopped first (what it showed so far is saved). */
export function closeChat(context: ChatTabContext, chatId: string) {
  if (isChatBusy(chatView(chatId))) stopTurn(chatTurn(context, chatId));
  disposeChat(chatId);
  if (tabChatIds(context.tab.id).length === 0) openChat(context.tab.id);
}

/** The open chat of the tab saved at `path`, if any. */
export function openChatSavedAt(tabId: string, path: string): string | undefined {
  return tabChatIds(tabId).find((chatId) => chatRuntime(chatId).state.chatSaveQueue.path === path);
}

/** Shows a saved chat: the open one when it is open, else it is read into a chat of its own, in
 * place of the shown chat when that is blank, or beside it. */
export async function loadChat(context: ChatTabContext, chat: SavedChat) {
  const tabId = context.tab.id;
  const open = openChatSavedAt(tabId, chat.path);
  if (open) {
    useChatStore.getState().select(tabId, open);
    return;
  }
  const current = activeChatId(tabId);
  // The saved conversation gets a chat of its own: a blank one shown now makes room for it.
  const target = current && isBlank(current) ? replaceChat(tabId, current) : openChat(tabId);
  const session = chatSessionFor(context, target);
  try {
    const file = await readSavedChat(chat.path);
    useWorkspaceStore.getState().setAgentMessages(target, file.messages);
    session.restore(chat.path, file);
    chatTurn(context, target).ui.setSubagents([]);
    void adoptBuiltinWorkflow(context.rootPath, readChatWorkflow(file.workflow), session.adoptChatWorkflowPath);
  } catch (e) {
    console.error("Failed to load chat:", e);
  }
}

/** The loaded chat follows the built-in workflow by its own path, when it followed it by an older one. */
async function adoptBuiltinWorkflow(rootPath: string, path: string | undefined, adopt: (path: string) => void) {
  if (!path || !rootPath) return;
  try {
    const document = await workflowCatalogService.workflow(rootPath, path);
    if (adoptsBuiltinPath(path, document)) adopt(BUILTIN_WORKFLOW_PATH);
  } catch {
    // An unreadable workflow is reported when the chat sends; nothing to adopt now.
  }
}

export async function deleteChat(event: React.MouseEvent, context: ChatTabContext, chat: SavedChat, removed: (path: string) => void) {
  event.stopPropagation();
  const open = openChatSavedAt(context.tab.id, chat.path);
  const session = open ? chatSessionFor(context, open) : undefined;
  try {
    if (session) await session.saved("deleting it");
    await invoke("delete_file_or_dir", { path: chat.path });
    removed(chat.path);
    session?.forget(chat.path);
  } catch (err) {
    console.error("Failed to delete chat:", err);
  }
}

/** Answers the run's oldest question to the user. */
export function answerAgentQuestion(turn: AgentTurn, questions: AgentQuestion[], answer: string) {
  const current = questions[0];
  if (!current) return;
  turn.state.questionResolvers.get(current.requestId)?.(answer);
  turn.state.questionResolvers.delete(current.requestId);
  turn.activity.report(`User answer: ${answer}`);
  turn.ui.setAgentQuestions((prev) => prev.slice(1));
}

/** Answers the oldest question a workflow step asked. */
export function answerWorkflowQuestion(turn: AgentTurn, questions: WorkflowQuestion[], answer: WorkflowAnswer) {
  const question = questions[0];
  if (!question) return;
  turn.activity.report(`Your answer to ${question.step}: ${answer.decision.replace(/_/g, " ")}${answer.text ? ` (${answer.text})` : ""}`);
  turn.state.workflowAnswers.get(question.requestId)?.(answer);
}
