import { useMemo } from "react";
import { recentPrompts, userPrompts } from "../../../services/promptHistory";
import { useWorkspaceStore, type AgentMessage } from "../../../store";
import type { TabOfType } from "../../../tabs/types";
import { openAgentChangedFile } from "../AgentTabChangedFile";
import { useWorkflowRunStore, type WorkflowRunView } from "../behaviors/workflowRunStore";
import type { AgentTurn } from "./turn";
import { useAgentModel, useAutoApprove, useSkillChoice } from "./useAgentModel";
import { useChatSearch } from "./useChatSearch";
import { useSavedChats } from "./useSavedChats";
import { useTabLifecycle } from "./useTabLifecycle";
import { useWorkflowDocument, useWorkflowOptions } from "./useWorkflowCatalog";
import { openChat } from "./chats/chatLifecycle";
import { chatRuntime } from "./chats/chatRuntime";
import { chatSessionView, type ChatSession } from "./chats/chatSession";
import { useChatStore } from "./chats/chatStore";
import { chatSessionFor, chatTurn, type ChatTabContext } from "./chats/chatTurn";
import { chatUi, turnUiView } from "./chats/chatUi";

const NO_MESSAGES: AgentMessage[] = [];

/** The workspace's workflows, the followed one's document, and the shown chat's run of it. */
function useWorkflows(rootPath: string, chatId: string, session: ChatSession) {
  const catalogVersion = useWorkflowRunStore((s) => s.catalogVersion);
  const chatRun = useWorkflowRunStore((s) => s.chatRuns[chatId]);
  const options = useWorkflowOptions(rootPath, catalogVersion);
  const document = useWorkflowDocument(rootPath, session.chatWorkflow, session.autoWorkflow, catalogVersion);
  // The bar reads runs by workflow id: only this chat's own run is offered.
  const runs = useMemo<Record<string, WorkflowRunView>>(() => (chatRun?.workflowId ? { [chatRun.workflowId]: chatRun } : {}), [chatRun]);
  return { options, document, runs };
}

/** Everything the Agent tab shows and does, for its views, for the chat it shows (`chatId`).
 * `turn()` is that chat as a message's runs see it; `chats` reaches the tab's other chats. */
export function useAgentTab(tab: TabOfType<"agent">, chatId: string) {
  const view = useChatStore((s) => s.chats[chatId]);
  const agentChats = useWorkspaceStore((s) => s.agentChats[chatId] ?? NO_MESSAGES);
  const rootPath = useWorkspaceStore((s) => s.rootPath);
  const repositories = useWorkspaceStore((s) => s.repositories);
  const openTab = useWorkspaceStore((s) => s.openTab);
  const runtime = chatRuntime(chatId);
  const model = useAgentModel();
  const skill = useSkillChoice();
  const search = useChatSearch(agentChats);
  const savedChats = useSavedChats(rootPath);
  const [autoApprove, setAutoApprove] = useAutoApprove();
  const openChangedFile = (path: string) => openAgentChangedFile(openTab, path, rootPath, repositories);
  const context = (): ChatTabContext => ({
    tab, rootPath, openChangedFile, autoApprove,
    selectedModel: model.selectedModel,
    selectedSkillId: skill.selectedSkillId,
    intelligentModelSelectionSettings: model.intelligentModelSelectionSettings,
    // Read when a turn is built: the session below is made before the workflows are.
    get workflowOptions() { return workflows.options; },
    onSaved: savedChats.loadChatHistory,
  });
  const run = turnUiView(view, chatUi(chatId, runtime));
  const session = chatSessionView(view, chatSessionFor(context(), chatId));
  const workflows = useWorkflows(rootPath, chatId, session);
  // This chat's prompts, then the saved chats' when it has fewer than the box offers. Reuses the
  // chats the history panel already read, so it costs no extra file access.
  const promptHistory = useMemo(() => recentPrompts(userPrompts(agentChats), savedChats.chatHistory), [agentChats, savedChats.chatHistory]);

  const turn = (): AgentTurn => chatTurn(context(), chatId);
  useTabLifecycle(context);
  const chats = {
    context,
    turnFor: (id: string) => chatTurn(context(), id),
    sessionFor: (id: string) => chatSessionFor(context(), id),
    open: () => openChat(tab.id),
    select: (id: string) => useChatStore.getState().select(tab.id, id),
  };

  return {
    tab, chatId, agentChats, activity: runtime.activity, model, skill, run, search, savedChats, session, workflows,
    autoApprove, setAutoApprove, promptHistory, openChangedFile, turn, chats,
  };
}

export type AgentTabModel = ReturnType<typeof useAgentTab>;
