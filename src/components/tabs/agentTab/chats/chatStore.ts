/**
 * The Agent tab's open chats: which are open in each tab, which one is shown,
 * and what each shows (its run, what it asks, what it is saved as). Each chat
 * keeps its own view, so a run goes on updating its chat while another is
 * shown. The messages themselves stay in the workspace store, keyed by chat id.
 */

import { create } from "zustand";
import type { SetStateAction } from "react";
import type { FailedWorkflowCheckpoint } from "../../../../harness/core/workflowRun";
import type { Todo } from "../../../../harness/core/definitions/todoTool";
import type { WorkflowQuestion } from "../../../../harness/contract";
import type { StepPlan } from "../../../agent/stepPlans";
import type { SubagentActivity } from "../../../ui/Chat";
import type { AgentQuestion } from "../../../ui/ChatInput";
import type { TokenUsageLike } from "../../../ui/TokenBadge/TokenBadge";
import { isActiveSubagent } from "../subagents";

export const DEFAULT_STREAMING_LABEL = "Model is thinking…";

/** What one chat shows. */
export interface ChatView {
  chatId: string;
  tabId: string;
  /** The message box's draft. */
  message: string;
  isStreaming: boolean;
  subagents: SubagentActivity[];
  runUsage: TokenUsageLike | null;
  streamingLabel: string;
  agentQuestions: AgentQuestion[];
  /** Questions a running workflow step put to the user (approvals), oldest first. */
  workflowQuestions: WorkflowQuestion[];
  workflowRunning: boolean;
  plan: Todo[];
  /** A workflow run's plans, one per step session. */
  stepPlans: StepPlan[];
  /** Where the chat is saved, once it has been. */
  activeChatPath: string | null;
  modifiedFiles: string[];
  chatWorkflow: string | undefined;
  /** With Auto, the workflow chosen for the latest message (drives the bar's steps). */
  autoWorkflow: string | undefined;
  flowSwitching: boolean;
  workflowCheckpoint: FailedWorkflowCheckpoint | undefined;
  /** The usage-limit reset this chat continues after by itself (ISO), once asked to. */
  continueAt: string | undefined;
}

interface TabChats {
  order: string[];
  activeChatId: string;
}

interface ChatStore {
  chats: Record<string, ChatView>;
  tabs: Record<string, TabChats>;
  /** Adds the chat to the tab, after the others or at strip position `at`, and shows it. */
  add(tabId: string, chatId: string, plan?: Todo[], at?: number): void;
  select(tabId: string, chatId: string): void;
  /** Takes the chat out of its tab; the one next to it is shown. */
  remove(chatId: string): void;
  /** Changes a chat's view; a chat no longer open, or a change to what it already shows, is left alone
   * (runs set the same status line on every token: re-rendering for it made the tab stutter). */
  patch(chatId: string, change: Partial<ChatView> | ((view: ChatView) => Partial<ChatView>)): void;
}

export function emptyChatView(tabId: string, chatId: string, plan: Todo[] = []): ChatView {
  return {
    chatId, tabId, message: "", isStreaming: false, subagents: [], runUsage: null, streamingLabel: DEFAULT_STREAMING_LABEL,
    agentQuestions: [], workflowQuestions: [], workflowRunning: false, plan, stepPlans: [],
    activeChatPath: null, modifiedFiles: [], chatWorkflow: undefined, autoWorkflow: undefined, flowSwitching: false, workflowCheckpoint: undefined,
    continueAt: undefined,
  };
}

export const useChatStore = create<ChatStore>((set) => ({
  chats: {},
  tabs: {},
  add: (tabId, chatId, plan, at) => set((state) => {
    const order = state.tabs[tabId]?.order ?? [];
    const placed = order.includes(chatId) ? order
      : at === undefined ? [...order, chatId]
      : [...order.slice(0, at), chatId, ...order.slice(at)];
    return {
      chats: { ...state.chats, [chatId]: emptyChatView(tabId, chatId, plan) },
      tabs: { ...state.tabs, [tabId]: { order: placed, activeChatId: chatId } },
    };
  }),
  select: (tabId, chatId) => set((state) => {
    const tab = state.tabs[tabId];
    if (!tab?.order.includes(chatId) || tab.activeChatId === chatId) return {};
    return { tabs: { ...state.tabs, [tabId]: { ...tab, activeChatId: chatId } } };
  }),
  remove: (chatId) => set((state) => {
    const view = state.chats[chatId];
    if (!view) return {};
    const { [chatId]: _removed, ...chats } = state.chats;
    const tab = state.tabs[view.tabId];
    if (!tab) return { chats };
    const at = tab.order.indexOf(chatId);
    const order = tab.order.filter((id) => id !== chatId);
    if (order.length === 0) {
      const { [view.tabId]: _tab, ...tabs } = state.tabs;
      return { chats, tabs };
    }
    const activeChatId = tab.activeChatId === chatId ? order[Math.min(at, order.length - 1)] : tab.activeChatId;
    return { chats, tabs: { ...state.tabs, [view.tabId]: { order, activeChatId } } };
  }),
  patch: (chatId, change) => set((state) => {
    const view = state.chats[chatId];
    if (!view) return state;
    const next = typeof change === "function" ? change(view) : change;
    const changed = (Object.keys(next) as (keyof ChatView)[]).some((key) => !Object.is(view[key], next[key]));
    return changed ? { chats: { ...state.chats, [chatId]: { ...view, ...next } } } : state;
  }),
}));

/** `value` applied to `previous`, as React's state setters do. */
export function applyAction<T>(previous: T, value: SetStateAction<T>): T {
  return typeof value === "function" ? (value as (prev: T) => T)(previous) : value;
}

export function chatView(chatId: string): ChatView | undefined {
  return useChatStore.getState().chats[chatId];
}

/** The chats open in the tab, in strip order. */
export function tabChatIds(tabId: string): string[] {
  return useChatStore.getState().tabs[tabId]?.order ?? [];
}

/** A chat is busy while its run streams or a subagent it started is still going. */
export function isChatBusy(view: ChatView | undefined): boolean {
  return Boolean(view && (view.isStreaming || view.subagents.some(isActiveSubagent)));
}

/** A chat waits for the user while a run's question or a step's approval is unanswered. */
export function chatNeedsInput(view: ChatView | undefined): boolean {
  return Boolean(view && (view.agentQuestions.length > 0 || view.workflowQuestions.length > 0));
}
