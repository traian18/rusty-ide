import { useEffect, useRef } from "react";
import { useWorkspaceStore } from "../../../store";
import { registerTabStop, unregisterTabStop } from "../../../tabs/tabStopRegistry";
import { useWorkflowRunStore } from "../behaviors/workflowRunStore";
import { closeTab, newChat, resetForWorkspace, stopAllChats } from "./tabActions";
import { isChatBusy, useChatStore } from "./chats/chatStore";
import { chatSessionFor, type ChatTabContext } from "./chats/chatTurn";

/** Whether any chat of the tab is running. */
function useAnyChatBusy(tabId: string): boolean {
  return useChatStore((state) => (state.tabs[tabId]?.order ?? []).some((chatId) => isChatBusy(state.chats[chatId])));
}

/** What the Agent tab does as it opens, closes, changes workspace, and as
 * other parts of the app ask things of it. `context` gives the tab as of the
 * latest render. */
export function useTabLifecycle(context: () => ChatTabContext) {
  const latest = useRef(context);
  latest.current = context;
  const { tab, rootPath } = context();
  const anyBusy = useAnyChatBusy(tab.id);
  const discoverRepositories = useWorkspaceStore((state) => state.discoverRepositories);
  const setAgentTabBusy = useWorkspaceStore((state) => state.setAgentTabBusy);
  const agentWorkflowRequest = useWorkflowRunStore((state) => state.agentRequest);
  const previousRootPathRef = useRef(rootPath);

  useEffect(() => {
    if (rootPath) void discoverRepositories();
  }, [rootPath, discoverRepositories]);

  // This tab's policy is keepAlive "always", so unmount means closed -- unless
  // the tab is still open (StrictMode's trial unmount), when its chats stay.
  useEffect(() => () => {
    if (!useWorkspaceStore.getState().tabs.some((open) => open.id === tab.id)) closeTab(tab.id);
  }, [tab.id]);

  // Mirrors whether any chat runs into the store so the `agent` tab policy -- a pure
  // function with no component access -- can implement isBusy/beforeClose.
  // Cleared on unmount so a stale `true` can never linger for the next Agent
  // tab (this is a singleton id, reused every time one is reopened).
  useEffect(() => {
    setAgentTabBusy(tab.id, anyBusy);
    return () => setAgentTabBusy(tab.id, false);
  }, [tab.id, anyBusy, setAgentTabBusy]);

  useEffect(() => {
    if (previousRootPathRef.current === rootPath) return;
    previousRootPathRef.current = rootPath;
    resetForWorkspace(tab.id);
  }, [rootPath, tab.id]);

  // Lets the close-intercept controller say "stop whatever this tab is
  // running" without knowing it is an Agent tab.
  useEffect(() => {
    registerTabStop(tab.id, () => stopAllChats(latest.current()));
    return () => unregisterTabStop(tab.id);
  }, [tab.id]);

  // "Run in Agent Mode" from the Behaviors tab: follow that workflow in the
  // shown chat when it is blank, else in a new one; running chats go on.
  useEffect(() => {
    if (!agentWorkflowRequest) return;
    const path = useWorkflowRunStore.getState().takeAgentRequest();
    if (!path) return;
    const chatId = newChat(latest.current());
    chatSessionFor(latest.current(), chatId).setChatWorkflow(path, { persist: false });
  }, [agentWorkflowRequest]);
}
