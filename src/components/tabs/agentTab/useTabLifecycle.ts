import { useEffect, useRef } from "react";
import { useWorkspaceStore } from "../../../store";
import { registerTabStop, unregisterTabStop } from "../../../tabs/tabStopRegistry";
import { useWorkflowRunStore } from "../behaviors/workflowRunStore";
import { closeTab, newChat, resetForWorkspace, stopTurn } from "./tabActions";
import type { AgentTurn } from "./turn";
import type { ChatSession } from "./useChatSession";

/** What the Agent tab does as it opens, closes, changes workspace, and as
 * other parts of the app ask things of it. `turn` gives the tab as of the
 * latest render. */
export function useTabLifecycle(turn: () => AgentTurn, session: ChatSession, isAgentBusy: boolean) {
  const latest = useRef(turn);
  latest.current = turn;
  const { tab, rootPath } = turn();
  const discoverRepositories = useWorkspaceStore((state) => state.discoverRepositories);
  const setAgentTabBusy = useWorkspaceStore((state) => state.setAgentTabBusy);
  const agentWorkflowRequest = useWorkflowRunStore((state) => state.agentRequest);
  const previousRootPathRef = useRef(rootPath);

  useEffect(() => {
    if (rootPath) void discoverRepositories();
  }, [rootPath, discoverRepositories]);

  // This tab's policy is keepAlive "always", so unmount means closed.
  useEffect(() => () => closeTab(latest.current()), [tab.id]);

  // Mirrors isAgentBusy into the store so the `agent` tab policy -- a pure
  // function with no component access -- can implement isBusy/beforeClose.
  // Cleared on unmount so a stale `true` can never linger for the next Agent
  // tab (this is a singleton id, reused every time one is reopened).
  useEffect(() => {
    setAgentTabBusy(tab.id, isAgentBusy);
    return () => setAgentTabBusy(tab.id, false);
  }, [tab.id, isAgentBusy, setAgentTabBusy]);

  useEffect(() => {
    if (previousRootPathRef.current === rootPath) return;
    previousRootPathRef.current = rootPath;
    resetForWorkspace(latest.current(), session);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rootPath, tab.id]);

  // Lets the close-intercept controller say "stop whatever this tab is
  // running" without knowing it is an Agent tab.
  useEffect(() => {
    registerTabStop(tab.id, () => stopTurn(latest.current()));
    return () => unregisterTabStop(tab.id);
  }, [tab.id]);

  // "Run in Agent Mode" from the Behaviors tab: follow that workflow in a
  // fresh chat (or this one, when it is still empty).
  useEffect(() => {
    if (!agentWorkflowRequest || isAgentBusy) return;
    const path = useWorkflowRunStore.getState().takeAgentRequest();
    if (!path) return;
    if ((useWorkspaceStore.getState().agentChats[tab.id] || []).length > 0) newChat(latest.current(), session);
    session.setChatWorkflow(path, { persist: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentWorkflowRequest, isAgentBusy]);
}
