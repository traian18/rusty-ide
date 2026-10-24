import type React from "react";
import { invoke } from "@tauri-apps/api/core";
import { harness } from "../../../harness";
import { clearTodos } from "../../../harness/core/definitions/todoTool";
import type { WorkflowAnswer, WorkflowQuestion } from "../../../harness/contract";
import { commandPermissionService } from "../../../services/commandPermissionService";
import { useWorkspaceStore } from "../../../store";
import type { AgentQuestion } from "../../ui/ChatInput";
import { readSavedChat, type SavedChat } from "./savedChats";
import { useWorkflowRunStore } from "../behaviors/workflowRunStore";
import { stopActiveSubagents } from "./subagents";
import { cancelResponseFlush, DEFAULT_STREAMING_LABEL, releasePendingQuestions, type AgentTurn } from "./turn";
import type { ChatSession } from "./useChatSession";

/** Stops the run, keeping the user's request and every update shown so far. */
export function stopTurn(turn: AgentTurn) {
  const { state, ui } = turn;
  const workflowId = state.activeWorkflowId;
  state.agentRun?.cancel();
  state.agentRun = null;
  state.activeWorkflowId = null;
  state.activeWorkflowRunId = null;
  ui.setWorkflowRunning(false);
  if (workflowId) useWorkflowRunStore.getState().finish(workflowId, "cancelled");
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

/** Forgets the backend session and every "allow this session" command grant
 * the user gave this tab. */
function releaseTabSession(tabId: string) {
  void harness.releaseSession(tabId);
  commandPermissionService.clearSession(tabId);
}

/** Another workspace was opened: the tab starts over in it, with nothing of the previous one running or shown. */
export function resetForWorkspace(turn: AgentTurn, session: ChatSession) {
  const { state, ui } = turn;
  state.agentRun?.cancel();
  state.agentRun = null;
  releaseTabSession(turn.tab.id);
  session.reset();
  clearTodos(turn.tab.id);
  ui.setPlan([]);
  ui.setStepPlans([]);
  ui.setWorkflowRunning(false);
  ui.setSubagents([]);
  ui.setRunUsage(null);
  ui.setStreamingLabel(DEFAULT_STREAMING_LABEL);
  ui.setAgentQuestions([]);
  turn.chat.clearWorkflowQuestions();
  state.isStreaming = false;
  ui.setIsStreaming(false);
  state.responseStream = null;
  releasePendingQuestions(state);
}

/** The tab closed: stop what runs and release its session. Grants outlive
 * individual runs, so they are cleared whether or not one is running. */
export function closeTab(turn: AgentTurn) {
  const { state } = turn;
  turn.activity.cancelScheduledFlush();
  cancelResponseFlush(state);
  if (state.agentRun) {
    void harness.releaseSession(turn.tab.id);
    state.agentRun.cancel();
    state.agentRun = null;
  }
  commandPermissionService.clearSession(turn.tab.id);
}

export function newChat(turn: AgentTurn, session: ChatSession) {
  useWorkspaceStore.getState().clearAgentMessages(turn.tab.id);
  session.reset();
  clearTodos(turn.tab.id);
  turn.ui.setPlan([]);
  turn.ui.setStepPlans([]);
  turn.ui.setSubagents([]);
}

export async function loadChat(turn: AgentTurn, session: ChatSession, chat: SavedChat) {
  try {
    await session.saved("loading another chat");
    const file = await readSavedChat(chat.path);
    useWorkspaceStore.getState().setAgentMessages(turn.tab.id, file.messages);
    session.restore(chat.path, file);
    turn.ui.setSubagents([]);
  } catch (e) {
    console.error("Failed to load chat:", e);
  }
}

export async function deleteChat(event: React.MouseEvent, session: ChatSession, chat: SavedChat, removed: (path: string) => void) {
  event.stopPropagation();
  try {
    if (session.savingTo() === chat.path) await session.saved("deleting it");
    await invoke("delete_file_or_dir", { path: chat.path });
    removed(chat.path);
    session.forget(chat.path);
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
