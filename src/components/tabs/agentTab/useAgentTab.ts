import { useMemo, useState } from "react";
import { recentPrompts, userPrompts } from "../../../services/promptHistory";
import { useWorkspaceStore } from "../../../store";
import type { TabOfType } from "../../../tabs/types";
import { openAgentChangedFile } from "../AgentTabChangedFile";
import { useWorkflowRunStore } from "../behaviors/workflowRunStore";
import { ActivityLog } from "./activityLog";
import { createTurnState, type AgentTurn } from "./turn";
import { useAgentModel, useAutoApprove, useSkillChoice } from "./useAgentModel";
import { useChatSearch } from "./useChatSearch";
import { useChatSession } from "./useChatSession";
import { useSavedChats } from "./useSavedChats";
import { useTabLifecycle } from "./useTabLifecycle";
import { useTurnUi } from "./useTurnUi";
import { useWorkflowDocument, useWorkflowOptions } from "./useWorkflowCatalog";

/** The console messages of this tab's chat, written through the store. */
function useActivityLog(tabId: string): ActivityLog {
  return useState(() => new ActivityLog({
    add: (message) => useWorkspaceStore.getState().addAgentMessage(tabId, message),
    update: (id, content, entries) => useWorkspaceStore.getState().updateAgentMessage(tabId, id, content, entries),
  }))[0];
}

/** The workspace's workflows, the followed one's document, and their runs. */
function useWorkflows(rootPath: string, session: ReturnType<typeof useChatSession>) {
  const catalogVersion = useWorkflowRunStore((s) => s.catalogVersion);
  const runs = useWorkflowRunStore((s) => s.runs);
  const options = useWorkflowOptions(rootPath, catalogVersion);
  const document = useWorkflowDocument(rootPath, session.chatWorkflow, session.autoWorkflow, catalogVersion, session.adoptChatWorkflowPath);
  return { options, document, runs };
}

/** Everything the Agent tab shows and does, for its views. `turn()` is the
 * tab as a message's runs see it. */
export function useAgentTab(tab: TabOfType<"agent">) {
  const agentChats = useWorkspaceStore((s) => s.agentChats[tab.id] || []);
  const rootPath = useWorkspaceStore((s) => s.rootPath);
  const repositories = useWorkspaceStore((s) => s.repositories);
  const openTab = useWorkspaceStore((s) => s.openTab);
  const state = useState(createTurnState)[0];
  const activity = useActivityLog(tab.id);
  const model = useAgentModel();
  const skill = useSkillChoice();
  const run = useTurnUi(tab.id);
  const search = useChatSearch(agentChats);
  const savedChats = useSavedChats(rootPath);
  const session = useChatSession(tab.id, rootPath, state, savedChats.loadChatHistory);
  const workflows = useWorkflows(rootPath, session);
  const [autoApprove, setAutoApprove] = useAutoApprove();
  // This chat's prompts, then the saved chats' when it has fewer than the box offers. Reuses the
  // chats the history panel already read, so it costs no extra file access.
  const promptHistory = useMemo(() => recentPrompts(userPrompts(agentChats), savedChats.chatHistory), [agentChats, savedChats.chatHistory]);
  state.autoApprove = autoApprove;
  state.workflowOptions = workflows.options;

  const openChangedFile = (path: string) => openAgentChangedFile(openTab, path, rootPath, repositories);
  const clearWorkflowQuestions = () => {
    run.ui.setWorkflowQuestions([]);
    state.workflowAnswers.clear();
  };
  const turn = (): AgentTurn => ({
    tab, rootPath, state, activity,
    selectedModel: model.selectedModel,
    selectedSkillId: skill.selectedSkillId,
    intelligentModelSelectionSettings: model.intelligentModelSelectionSettings,
    ui: { ...run.ui, setAutoWorkflow: session.setAutoWorkflow },
    chat: { ...session, openChangedFile, clearWorkflowQuestions },
    addMessage: (message) => useWorkspaceStore.getState().addAgentMessage(tab.id, message),
    updateMessage: (id, content) => useWorkspaceStore.getState().updateAgentMessage(tab.id, id, content),
  });
  useTabLifecycle(turn, session, run.isAgentBusy);

  return {
    tab, agentChats, activity, model, skill, run, search, savedChats, session, workflows,
    autoApprove, setAutoApprove, promptHistory, openChangedFile, turn,
  };
}

export type AgentTabModel = ReturnType<typeof useAgentTab>;
