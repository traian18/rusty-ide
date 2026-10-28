// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useSpecLaunch } from "../../../specs/launchStore";
import { usePendingSpecRun } from "./usePendingSpecRun";
import type { AgentTabModel } from "./useAgentTab";
import { useWorkspaceStore } from "../../../store";
import { fakeChatTab } from "../../../test/fakeChatTab";
import { tabChatIds, useChatStore } from "./chats/chatStore";

let container: HTMLDivElement;
let root: Root;

const fakeAgent = (tabId: string, options: { id: string; path: string }[]) => fakeChatTab(tabId, options);
function Probe({ agent }: { agent: AgentTabModel }) {
  usePendingSpecRun(agent);
  return null;
}
const mount = async (agent: AgentTabModel) => {
  await act(async () => root.render(<Probe agent={agent} />));
};
const pending = { tabId: "t1", run: { root: "/repo", change: "0001-albums", step: "specify" as const }, message: "Write the spec.\n\nNotes: " };

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  useSpecLaunch.getState().clear();
  container = document.createElement("div");
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.unstubAllGlobals();
});

describe("usePendingSpecRun", () => {
  it("follows the step's workflow, fills the message box and remembers the run", async () => {
    const tab = fakeAgent("t1", [{ id: "design", path: "x" }, { id: "specify", path: "builtin/specify" }]);
    useSpecLaunch.getState().request(pending);
    await mount(tab.agent);
    const { view, state } = tab.active();
    // A fresh chat in place of the blank one: the run starts its own conversation.
    expect(tabChatIds("t1")).toEqual([tab.activeChatId()]);
    expect(view.chatWorkflow).toBe("builtin/specify");
    expect(view.message).toBe("Write the spec.\n\nNotes: ");
    expect(state.specRun).toEqual({ root: "/repo", change: "0001-albums", step: "specify", workflowPath: "builtin/specify" });
    expect(useSpecLaunch.getState().pending).toBeNull();
  });

  it("leaves a run that was opened for another tab alone", async () => {
    const tab = fakeAgent("other", [{ id: "specify", path: "p" }]);
    useSpecLaunch.getState().request(pending);
    await mount(tab.agent);
    expect(tab.active().view.chatWorkflow).toBeUndefined();
    expect(useSpecLaunch.getState().pending).not.toBeNull();
  });

  it("opens a new chat beside one with a conversation or a run, which goes on as it was", async () => {
    const tab = fakeAgent("t1", [{ id: "specify", path: "p" }]);
    useWorkspaceStore.setState({ agentChats: { t1: [{ id: "m1", role: "user", content: "earlier", timestamp: "2026-10-26T00:00:00Z" }] } });
    useChatStore.getState().patch("t1", { isStreaming: true });
    useSpecLaunch.getState().request(pending);
    await mount(tab.agent);
    expect(tabChatIds("t1")).toHaveLength(2);
    expect(tab.activeChatId()).not.toBe("t1");
    expect(tab.active().view.chatWorkflow).toBe("p");
    expect(useWorkspaceStore.getState().agentChats.t1).toHaveLength(1);
    expect(useChatStore.getState().chats.t1.isStreaming).toBe(true);
    expect(useChatStore.getState().chats.t1.chatWorkflow).toBeUndefined();
  });

  it("waits until the workflow catalog has loaded", async () => {
    const empty = fakeAgent("t1", []);
    useSpecLaunch.getState().request(pending);
    await mount(empty.agent);
    expect(empty.active().view.chatWorkflow).toBeUndefined();
    const loaded = fakeAgent("t1", [{ id: "specify", path: "p" }]);
    await mount(loaded.agent);
    expect(loaded.active().view.chatWorkflow).toBe("p");
  });
});
