// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useSpecLaunch } from "../../../specs/launchStore";
import { createTurnState } from "./turn";
import type { AgentTabModel } from "./useAgentTab";

const send = vi.fn(async () => undefined);
vi.mock("./sendMessage", () => ({ sendMessage: (...args: unknown[]) => send(...(args as [])) }));

const { usePendingSpecRun } = await import("./usePendingSpecRun");

let container: HTMLDivElement;
let root: Root;

function Probe({ agent }: { agent: AgentTabModel }) {
  usePendingSpecRun(agent);
  return null;
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  send.mockClear();
  useSpecLaunch.getState().clear();
  container = document.createElement("div");
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.unstubAllGlobals();
});

function fakeAgent() {
  const state = createTurnState();
  const setMessage = vi.fn();
  const agent = { tab: { id: "t1" }, workflows: { options: [{ id: "onboard-capability", path: "p" }] }, session: { setChatWorkflow: vi.fn() }, run: { ui: { setMessage } }, turn: () => ({ state }) } as unknown as AgentTabModel;
  return { agent, state, setMessage };
}
const run = (change: string) => ({ root: "/repo", change, step: "capability" as const });

describe("usePendingSpecRun for a batch of capability specs", () => {
  it("sends the first message by itself and keeps the rest queued", async () => {
    const { agent, state, setMessage } = fakeAgent();
    useSpecLaunch.getState().request({ tabId: "t1", run: run("a"), message: "Write a", autoSend: true, queue: [{ run: run("b"), message: "Write b" }] });
    await act(async () => root.render(<Probe agent={agent} />));
    expect(send).toHaveBeenCalledWith(expect.anything(), "Write a", [], true);
    expect(setMessage).not.toHaveBeenCalled();
    expect(state.specRun).toEqual({ ...run("a"), workflowPath: "p" });
    expect(state.specQueue.map((queued) => queued.run.change)).toEqual(["b"]);
  });

  it("leaves a single run for the person to send", async () => {
    const { agent, state, setMessage } = fakeAgent();
    useSpecLaunch.getState().request({ tabId: "t1", run: run("a"), message: "Write a" });
    await act(async () => root.render(<Probe agent={agent} />));
    expect(send).not.toHaveBeenCalled();
    expect(setMessage).toHaveBeenCalledWith("Write a");
    expect(state.specQueue).toEqual([]);
  });
});
