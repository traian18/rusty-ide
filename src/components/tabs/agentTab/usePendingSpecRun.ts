import { useEffect } from "react";

import { useSpecLaunch } from "../../../specs/launchStore";
import { SPEC_WORKFLOW } from "../../../specs/run";
import { sendMessage } from "./sendMessage";
import { newChat } from "./tabActions";
import type { AgentTabModel } from "./useAgentTab";

/**
 * Picks up a Specify or Plan run the Specs page opened this tab for: follows the workflow in the
 * shown chat when it is blank, else in a new chat beside it (a chat still running goes on), puts the
 * message in the box and remembers the run, so the person can add notes and send. The run is
 * written into the change folder when it completes (`runOutcome.ts`).
 */
export function usePendingSpecRun(agent: AgentTabModel): void {
  const pending = useSpecLaunch((state) => state.pending);
  const { tab, workflows, chats } = agent;
  const option = pending?.tabId === tab.id ? workflows.options.find((candidate) => candidate.id === SPEC_WORKFLOW[pending.run.step]) : undefined;
  useEffect(() => {
    if (!pending || !option) return;
    useSpecLaunch.getState().clear();
    const chatId = newChat(chats.context());
    const turn = chats.turnFor(chatId);
    chats.sessionFor(chatId).setChatWorkflow(option.path);
    turn.state.specRun = { ...pending.run, workflowPath: option.path };
    turn.state.specQueue = pending.queue ?? [];
    if (pending.autoSend) void sendMessage(turn, pending.message, [], true);
    else turn.ui.setMessage(pending.message);
    // The catalog finishing its load is what makes the workflow available; nothing else changes the outcome.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending, option]);
}
