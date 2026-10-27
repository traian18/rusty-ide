// Test support: an Agent tab model over the real chat store, without React.
import type { WorkflowChoice } from "../components/tabs/behaviors/AgentWorkflowBar";
import type { AgentTabModel } from "../components/tabs/agentTab/useAgentTab";
import { disposeTabChats, ensureChat, openChat } from "../components/tabs/agentTab/chats/chatLifecycle";
import { chatRuntime } from "../components/tabs/agentTab/chats/chatRuntime";
import { chatView, useChatStore } from "../components/tabs/agentTab/chats/chatStore";
import { chatSessionFor, chatTurn, type ChatTabContext } from "../components/tabs/agentTab/chats/chatTurn";

/** A tab `tabId` with one chat open; `options` are the workflows its picker offers. */
export function fakeChatTab(tabId: string, options: Array<Pick<WorkflowChoice, "id" | "path">> = []) {
  disposeTabChats(tabId);
  ensureChat(tabId);
  const context = (): ChatTabContext => ({
    tab: { id: tabId, type: "agent", title: "Agent", status: "idle", dirty: false } as ChatTabContext["tab"],
    rootPath: "/ws",
    selectedModel: "model-a",
    selectedSkillId: "build",
    intelligentModelSelectionSettings: {} as ChatTabContext["intelligentModelSelectionSettings"],
    autoApprove: false,
    workflowOptions: options as WorkflowChoice[],
    openChangedFile: () => {},
    onSaved: async () => {},
  });
  const chats = {
    context,
    turnFor: (id: string) => chatTurn(context(), id),
    sessionFor: (id: string) => chatSessionFor(context(), id),
    open: () => openChat(tabId),
    select: (id: string) => useChatStore.getState().select(tabId, id),
  };
  const agent = { tab: context().tab, workflows: { options }, chats } as unknown as AgentTabModel;
  const activeChatId = () => useChatStore.getState().tabs[tabId]?.activeChatId ?? "";
  return {
    agent,
    chats,
    activeChatId,
    /** The shown chat's view and run state. */
    active: () => ({ view: chatView(activeChatId())!, state: chatRuntime(activeChatId()).state }),
  };
}
