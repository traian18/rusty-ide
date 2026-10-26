import { useEffect } from "react";

import { useSpecLaunch } from "../../../specs/launchStore";
import { useWorkspaceStore } from "../../../store";
import { SPEC_WORKFLOW } from "../../../specs/run";
import { sendMessage } from "./sendMessage";
import { newChat } from "./tabActions";
import type { AgentTabModel } from "./useAgentTab";

/**
 * Picks up a Specify or Plan run the Specs page opened this tab for: starts a fresh chat when this
 * one already has a conversation, follows the workflow, puts the message in the box and remembers
 * the run, so the person can add notes and send. The run is written into the change folder when it
 * completes (`runOutcome.ts`). A run still going in the tab is let finish first.
 */
export function usePendingSpecRun(agent: AgentTabModel): void {
  const pending = useSpecLaunch((state) => state.pending);
  const { tab, workflows, session, run, turn } = agent;
  const option = pending?.tabId === tab.id ? workflows.options.find((candidate) => candidate.id === SPEC_WORKFLOW[pending.run.step]) : undefined;
  const busy = run.isAgentBusy;
  useEffect(() => {
    if (!pending || !option || busy) return;
    useSpecLaunch.getState().clear();
    if ((useWorkspaceStore.getState().agentChats[tab.id] || []).length > 0) newChat(turn(), session);
    session.setChatWorkflow(option.path);
    turn().state.specRun = { ...pending.run, workflowPath: option.path };
    turn().state.specQueue = pending.queue ?? [];
    if (pending.autoSend) void sendMessage(turn(), pending.message, [], true);
    else run.ui.setMessage(pending.message);
    // The catalog finishing its load is what makes the workflow available; nothing else changes the outcome.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending, option, busy]);
}
