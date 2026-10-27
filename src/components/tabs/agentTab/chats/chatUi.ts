import type { SetStateAction } from "react";
import { isActiveSubagent } from "../subagents";
import type { TurnUi } from "../turn";
import { applyAction, isChatBusy, useChatStore, type ChatView } from "./chatStore";
import { isCurrentRuntime, type ChatRuntime } from "./chatRuntime";

type ListField = "subagents" | "agentQuestions" | "workflowQuestions" | "stepPlans";

/** The setters a chat's runs drive, writing to that chat's view whichever chat is shown.
 * Once the chat is closed (its runtime gone) they do nothing. */
export function chatUi(chatId: string, runtime: ChatRuntime): Omit<TurnUi, "setAutoWorkflow"> {
  const patch = (change: Partial<ChatView> | ((view: ChatView) => Partial<ChatView>)) => {
    if (isCurrentRuntime(chatId, runtime)) useChatStore.getState().patch(chatId, change);
  };
  const list = <K extends ListField>(field: K) => (value: SetStateAction<ChatView[K]>) =>
    patch((view) => ({ [field]: applyAction(view[field], value) }) as Partial<ChatView>);
  return {
    setSubagents: list("subagents"),
    setAgentQuestions: list("agentQuestions"),
    setWorkflowQuestions: list("workflowQuestions"),
    setStepPlans: list("stepPlans"),
    setRunUsage: (runUsage) => patch({ runUsage }),
    setStreamingLabel: (streamingLabel) => patch({ streamingLabel }),
    setIsStreaming: (isStreaming) => patch({ isStreaming }),
    setWorkflowRunning: (workflowRunning) => patch({ workflowRunning }),
    setPlan: (plan) => patch({ plan }),
    setMessage: (message) => patch({ message }),
  };
}

/** What the tab shows of a chat's run in progress: its status, plan, subagents,
 * usage, and what it asks of the user. */
export function turnUiView(view: ChatView, ui: Omit<TurnUi, "setAutoWorkflow">) {
  const { message, isStreaming, subagents, runUsage, streamingLabel, agentQuestions, workflowQuestions, workflowRunning, plan, stepPlans } = view;
  return {
    ui, message, isStreaming, subagents, runUsage, streamingLabel, agentQuestions, workflowQuestions, workflowRunning, plan, stepPlans,
    hasActiveSubagents: subagents.some(isActiveSubagent), isAgentBusy: isChatBusy(view),
  };
}

export type TurnUiView = ReturnType<typeof turnUiView>;
