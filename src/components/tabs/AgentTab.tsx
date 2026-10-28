import React, { useLayoutEffect, useState } from "react";
import { PlanPanel } from "../agent/PlanPanel";
import { useWorkspaceStore } from "../../store";
import { Chat } from "../ui/Chat";
import { ChatQueryRail } from "../ui/ChatQueryRail";
import type { TabOfType } from "../../tabs/types";
import { AUTO_FLOW } from "./behaviors/flowCatalog";
import { AgentComposer, ModifiedFilesBar } from "./agentTab/AgentComposer";
import { AgentTabHeader } from "./agentTab/AgentTabHeader";
import { ChatHistorySidebar } from "./agentTab/ChatHistorySidebar";
import { ChatStrip } from "./agentTab/ChatStrip";
import { ensureChat } from "./agentTab/chats/chatLifecycle";
import { chatNeedsInput, isChatBusy, useChatStore } from "./agentTab/chats/chatStore";
import { sendMessage, type AttachedFile } from "./agentTab/sendMessage";
import { answerAgentQuestion, answerWorkflowQuestion, closeChat, deleteChat, loadChat, newChat, openChatSavedAt, stopTurn } from "./agentTab/tabActions";
import { useAgentTab, type AgentTabModel } from "./agentTab/useAgentTab";
import { usePendingSpecRun } from "./agentTab/usePendingSpecRun";
import { cancelContinue, CONTINUE_MESSAGE, scheduleContinue, usageLimitOffer } from "./agentTab/usageLimit";

interface AgentTabProps {
  tab: TabOfType<"agent">;
}

/** A message needs a skill when the single agent may answer it: no workflow
 * is followed, or Auto may still answer directly. */
function needsSkill(chatWorkflow: string | undefined): boolean {
  return !chatWorkflow || chatWorkflow === AUTO_FLOW;
}

/** With Auto the skill is locked only while the workflow it chose is running;
 * between messages it may still answer directly. */
function isSkillLocked(chatWorkflow: string | undefined, autoWorkflow: string | undefined, workflowRunning: boolean): boolean {
  return chatWorkflow === AUTO_FLOW ? Boolean(autoWorkflow) && workflowRunning : Boolean(chatWorkflow);
}

/** How an open chat saved at `path` is going, for the history list. */
function useSavedChatStatus(tabId: string) {
  // Re-render when a chat of the tab changes status (not on every token); the lookup reads the latest.
  useChatStore((s) => (s.tabs[tabId]?.order ?? []).map((id) => `${isChatBusy(s.chats[id])}${chatNeedsInput(s.chats[id])}`).join());
  return (path: string) => {
    const chatId = openChatSavedAt(tabId, path);
    const view = chatId ? useChatStore.getState().chats[chatId] : undefined;
    return chatNeedsInput(view) ? "input" as const : isChatBusy(view) ? "running" as const : undefined;
  };
}

function HistoryPanel({ agent, onHide }: { agent: AgentTabModel; onHide: () => void }) {
  const { savedChats, session, chats } = agent;
  const statusOf = useSavedChatStatus(agent.tab.id);
  return (
    <ChatHistorySidebar
      chats={savedChats.chatHistory}
      activeChatPath={session.activeChatPath}
      loading={savedChats.loadingHistory}
      onRefresh={savedChats.loadChatHistory}
      onNewChat={() => newChat(chats.context())}
      onHide={onHide}
      onLoad={(chat) => loadChat(chats.context(), chat)}
      onDelete={(event, chat) => deleteChat(event, chats.context(), chat, savedChats.removeChat)}
      statusOf={(chat) => statusOf(chat.path)}
    />
  );
}

function ChatPane({ agent }: { agent: AgentTabModel }) {
  const { agentChats, search, run, session } = agent;
  return (
    <div className="flex flex-1 min-h-0 min-w-0">
      <ChatQueryRail queries={search.queryMetadata} activeQueryId={search.activeQueryId} onSelect={search.selectQuery} disabled={agentChats.length === 0} />
      <Chat
        messages={agentChats}
        onTogglePin={(messageId, pinned) => {
          // Saved so the pin survives reopening the chat.
          useWorkspaceStore.getState().setAgentMessagePinned(agent.chatId, messageId, pinned);
          void session.save();
        }}
        isStreaming={run.isAgentBusy}
        streamingMessageId={agent.activity.messageId}
        streamingLabel={run.streamingLabel}
        subagents={run.subagents}
        followLatest
        turnLayout
        explicitScrollTarget={search.scrollTarget}
        onScrollTargetHandled={search.onScrollTargetHandled}
        onVisibleMessageChange={search.handleVisibleMessageChange}
        activeMessageId={search.activeSearchMatch?.messageId || search.activeQueryId}
        searchMatches={search.searchMatches}
        activeSearchMatch={search.activeSearchMatch}
      />
    </div>
  );
}

function Composer({ agent }: { agent: AgentTabModel }) {
  const { run, session, skill, workflows, turn } = agent;
  const handleSend = async (attachedFiles: AttachedFile[]) => {
    if ((!run.message.trim() && attachedFiles.length === 0) || run.isAgentBusy) return;
    await sendMessage(turn(), run.message, attachedFiles, skill.hasSelectedSkill);
  };
  const startOver = () => {
    session.setWorkflowCheckpoint(undefined);
    void session.save();
  };
  // The continue belongs to this chat: it is scheduled on its turn and sent to it, whichever chat is shown then.
  const usageLimit = usageLimitOffer(agent.agentChats, run.continueAt, {
    schedule: (resetsAt) => scheduleContinue(turn(), resetsAt, (owner) => void sendMessage(owner, CONTINUE_MESSAGE, [], skill.hasSelectedSkill)),
    cancel: () => cancelContinue(turn()),
  });
  return (
    <AgentComposer
      workflows={workflows.options}
      chatWorkflow={session.chatWorkflow}
      workflowDocument={workflows.document}
      workflowRuns={workflows.runs}
      workflowRunning={run.workflowRunning}
      autoAvailable={agent.model.autoAvailable}
      flowSwitching={session.flowSwitching}
      autoApprove={agent.autoApprove}
      onAutoApproveChange={agent.setAutoApprove}
      onFlowSwitchingChange={(allowed) => session.setFlowSwitching(allowed)}
      onSelectWorkflow={(path) => {
        // Another workflow than the one a Specs page run was set up for: the person changed their mind.
        if (path !== turn().state.specRun?.workflowPath) turn().state.specRun = undefined;
        session.setChatWorkflow(path);
      }}
      resumable={Boolean(session.workflowCheckpoint) && !run.isAgentBusy && session.chatWorkflow !== AUTO_FLOW}
      onStartOver={startOver}
      usageLimit={run.isAgentBusy ? undefined : usageLimit}
      workflowQuestion={run.workflowQuestions[0]}
      onWorkflowAnswer={(answer) => answerWorkflowQuestion(turn(), run.workflowQuestions, answer)}
      message={run.message}
      onMessageChange={run.ui.setMessage}
      onSend={handleSend}
      sendDisabled={run.isAgentBusy || (!skill.hasSelectedSkill && needsSkill(session.chatWorkflow))}
      isAgentBusy={run.isAgentBusy}
      onStop={() => stopTurn(turn())}
      agentQuestion={run.agentQuestions[0] || null}
      onAgentQuestionAnswer={(answer) => answerAgentQuestion(turn(), run.agentQuestions, answer)}
      promptHistory={agent.promptHistory}
    />
  );
}

/** The tab shows one of its chats at a time; the others go on running. */
export const AgentTab: React.FC<AgentTabProps> = ({ tab }) => {
  const chatId = useChatStore((s) => s.tabs[tab.id]?.activeChatId);
  // The first chat opens before the tab paints; another workspace's reset opens a new one at once.
  useLayoutEffect(() => {
    if (!chatId) ensureChat(tab.id);
  }, [chatId, tab.id]);
  return chatId ? <AgentChatView tab={tab} chatId={chatId} /> : null;
};

function AgentChatView({ tab, chatId }: AgentTabProps & { chatId: string }) {
  const agent = useAgentTab(tab, chatId);
  usePendingSpecRun(agent);
  const { run, session, chats } = agent;
  const [showHistory, setShowHistory] = useState(true);
  return (
    <div className="w-full h-full flex bg-[var(--bg-app)] text-[var(--text-normal)] font-mono relative terminal-theme-tab">
      {showHistory && <HistoryPanel agent={agent} onHide={() => setShowHistory(false)} />}
      <div className="relative flex-1 flex flex-col h-full min-w-0 overflow-hidden">
        <PlanPanel plan={run.plan} steps={run.stepPlans} />
        <AgentTabHeader
          historyHidden={!showHistory}
          onShowHistory={() => setShowHistory(true)}
          model={agent.model}
          skill={agent.skill}
          skillLocked={isSkillLocked(session.chatWorkflow, session.autoWorkflow, run.workflowRunning)}
          modifiedFileCount={session.modifiedFiles.length}
          search={agent.search}
          runUsage={run.runUsage}
          isStreaming={run.isStreaming}
          isAgentBusy={run.isAgentBusy}
          hasActiveSubagents={run.hasActiveSubagents}
        />
        <ChatStrip
          tabId={tab.id}
          onSelect={chats.select}
          onClose={(id) => closeChat(chats.context(), id)}
          onNewChat={() => newChat(chats.context())}
        />
        <ModifiedFilesBar files={session.modifiedFiles} onOpen={agent.openChangedFile} />
        <div className="flex-1 flex flex-col min-h-0 min-w-0 overflow-hidden max-w-6xl mx-auto w-full">
          <ChatPane agent={agent} />
          <Composer agent={agent} />
        </div>
      </div>
    </div>
  );
}
