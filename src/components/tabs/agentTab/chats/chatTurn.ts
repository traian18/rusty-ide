import { useWorkspaceStore } from "../../../../store";
import type { TabOfType } from "../../../../tabs/types";
import type { WorkflowChoice } from "../../behaviors/AgentWorkflowBar";
import type { AgentTurn } from "../turn";
import { chatRuntime, isCurrentRuntime } from "./chatRuntime";
import { chatSession, type ChatSessionActions } from "./chatSession";
import { chatUi } from "./chatUi";

/** What every chat of the tab shares, as of the latest render: the tab, the workspace, and the
 * model, skill and approval choices a message is sent with. */
export interface ChatTabContext {
  tab: TabOfType<"agent">;
  rootPath: string;
  selectedModel: string;
  selectedSkillId: string;
  intelligentModelSelectionSettings: AgentTurn["intelligentModelSelectionSettings"];
  autoApprove: boolean;
  workflowOptions: WorkflowChoice[];
  openChangedFile(path: string): void;
  /** Called after a chat is saved (refreshes the history list). */
  onSaved(): Promise<void>;
}

/** The chat's saved-conversation operations. */
export function chatSessionFor(context: ChatTabContext, chatId: string): ChatSessionActions {
  return chatSession(chatId, context.rootPath, chatRuntime(chatId), context.onSaved);
}

/** The chat as a message's runs see it: everything they write lands in this chat, whichever is shown. */
export function chatTurn(context: ChatTabContext, chatId: string): AgentTurn {
  const runtime = chatRuntime(chatId);
  const { state, activity } = runtime;
  const session = chatSession(chatId, context.rootPath, runtime, context.onSaved);
  const ui = chatUi(chatId, runtime);
  state.autoApprove = context.autoApprove;
  state.workflowOptions = context.workflowOptions;
  const clearWorkflowQuestions = () => {
    ui.setWorkflowQuestions([]);
    state.workflowAnswers.clear();
  };
  return {
    tab: context.tab,
    chatId,
    rootPath: context.rootPath,
    state,
    activity,
    selectedModel: context.selectedModel,
    selectedSkillId: context.selectedSkillId,
    intelligentModelSelectionSettings: context.intelligentModelSelectionSettings,
    ui: { ...ui, setAutoWorkflow: session.setAutoWorkflow },
    chat: { ...session, openChangedFile: context.openChangedFile, clearWorkflowQuestions },
    addMessage: (message) => {
      if (isCurrentRuntime(chatId, runtime)) useWorkspaceStore.getState().addAgentMessage(chatId, message);
    },
    updateMessage: (id, content) => {
      if (isCurrentRuntime(chatId, runtime)) useWorkspaceStore.getState().updateAgentMessage(chatId, id, content);
    },
  };
}
