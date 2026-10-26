// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useSpecLaunch } from "../../../specs/launchStore";
import { createTurnState } from "./turn";
import { usePendingSpecRun } from "./usePendingSpecRun";
import type { AgentTabModel } from "./useAgentTab";
import { useWorkspaceStore } from "../../../store";

let container: HTMLDivElement;
let root: Root;

function fakeAgent(tabId: string, options: { id: string; path: string }[], isAgentBusy = false) {
  const state = createTurnState();
  const setChatWorkflow = vi.fn();
  const reset = vi.fn();
  const setMessage = vi.fn();
  const ui = { setPlan: vi.fn(), setStepPlans: vi.fn(), setSubagents: vi.fn() };
  const agent = { tab: { id: tabId }, workflows: { options }, session: { setChatWorkflow, reset }, run: { ui: { setMessage }, isAgentBusy }, turn: () => ({ state, tab: { id: tabId }, ui }) } as unknown as AgentTabModel;
  return { agent, state, setChatWorkflow, setMessage, reset };
}
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
    const { agent, state, setChatWorkflow, setMessage } = fakeAgent("t1", [{ id: "design", path: "x" }, { id: "specify", path: "builtin/specify" }]);
    useSpecLaunch.getState().request(pending);
    await mount(agent);
    expect(setChatWorkflow).toHaveBeenCalledWith("builtin/specify");
    expect(setMessage).toHaveBeenCalledWith("Write the spec.\n\nNotes: ");
    expect(state.specRun).toEqual({ root: "/repo", change: "0001-albums", step: "specify", workflowPath: "builtin/specify" });
    expect(useSpecLaunch.getState().pending).toBeNull();
  });

  it("leaves a run that was opened for another tab alone", async () => {
    const { agent, setChatWorkflow } = fakeAgent("other", [{ id: "specify", path: "p" }]);
    useSpecLaunch.getState().request(pending);
    await mount(agent);
    expect(setChatWorkflow).not.toHaveBeenCalled();
    expect(useSpecLaunch.getState().pending).not.toBeNull();
  });

  it("starts a fresh chat when the tab already shows a conversation, and waits for a run to finish", async () => {
    useWorkspaceStore.setState({ agentChats: { t1: [{ id: "m1", role: "user", content: "earlier", timestamp: "2026-10-26T00:00:00Z" }] } });
    const busy = fakeAgent("t1", [{ id: "specify", path: "p" }], true);
    useSpecLaunch.getState().request(pending);
    await mount(busy.agent);
    expect(busy.setChatWorkflow).not.toHaveBeenCalled();
    const idle = fakeAgent("t1", [{ id: "specify", path: "p" }]);
    await mount(idle.agent);
    expect(idle.reset).toHaveBeenCalled();
    expect(useWorkspaceStore.getState().agentChats.t1 ?? []).toHaveLength(0);
    expect(idle.setChatWorkflow).toHaveBeenCalledWith("p");
  });

  it("waits until the workflow catalog has loaded", async () => {
    const empty = fakeAgent("t1", []);
    useSpecLaunch.getState().request(pending);
    await mount(empty.agent);
    expect(empty.setChatWorkflow).not.toHaveBeenCalled();
    const loaded = fakeAgent("t1", [{ id: "specify", path: "p" }]);
    await mount(loaded.agent);
    expect(loaded.setChatWorkflow).toHaveBeenCalledWith("p");
  });
});
