import type React from "react";
import { invoke } from "@tauri-apps/api/core";
import { clearTodos } from "../../../harness/core/definitions/todoTool";
import type { WorkflowAnswer, WorkflowQuestion } from "../../../harness/contract";
import { useWorkspaceStore } from "../../../store";
import type { AgentQuestion } from "../../ui/ChatInput";
import { readSavedChat, type SavedChat } from "./savedChats";
import { useWorkflowRunStore } from "../behaviors/workflowRunStore";
import { stopActiveSubagents } from "./subagents";
import { cancelResponseFlush, DEFAULT_STREAMING_LABEL, releasePendingQuestions, type AgentTurn } from "./turn";
import { disposeChat, disposeTabChats, openChat } from "./chats/chatLifecycle";
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

/** A chat with nothing in it and nothing running: a new chat or a loaded one may take its place. */
function isBlank(chatId: string): boolean {
  return !isChatBusy(chatView(chatId)) && (useWorkspaceStore.getState().agentChats[chatId] || []).length === 0;
}

function activeChatId(tabId: string): string | undefined {
  return useChatStore.getState().tabs[tabId]?.activeChatId;
}

/** Starts the shown chat over when it is blank (forgetting its workflow and save), else opens
 * another chat beside it; any chat that runs goes on running. The chat to use. */
export function newChat(context: ChatTabContext): string {
  const current = activeChatId(context.tab.id);
  if (!current || !isBlank(current)) return openChat(context.tab.id);
  const turn = chatTurn(context, current);
  useWorkspaceStore.getState().clearAgentMessages(current);
  chatSessionFor(context, current).reset();
  clearTodos(current);
  turn.ui.setPlan([]);
  turn.ui.setStepPlans([]);
  turn.ui.setSubagents([]);
  return current;
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

/** Shows a saved chat: the open one when it is open, else it is read into the shown chat when
 * that is blank, or into a new one beside it. */
export async function loadChat(context: ChatTabContext, chat: SavedChat) {
  const tabId = context.tab.id;
  const open = openChatSavedAt(tabId, chat.path);
  if (open) {
    useChatStore.getState().select(tabId, open);
    return;
  }
  const current = activeChatId(tabId);
  const target = current && isBlank(current) ? current : openChat(tabId);
  const session = chatSessionFor(context, target);
  try {
    await session.saved("loading another chat");
    const file = await readSavedChat(chat.path);
    useWorkspaceStore.getState().setAgentMessages(target, file.messages);
    session.restore(chat.path, file);
    chatTurn(context, target).ui.setSubagents([]);
  } catch (e) {
    console.error("Failed to load chat:", e);
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
