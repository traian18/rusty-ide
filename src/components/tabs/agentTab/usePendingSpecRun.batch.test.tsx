// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useSpecLaunch } from "../../../specs/launchStore";
import type { AgentTabModel } from "./useAgentTab";
import { fakeChatTab } from "../../../test/fakeChatTab";

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
  const tab = fakeChatTab("t1", [{ id: "onboard-capability", path: "p" }]);
  return { agent: tab.agent, state: tab.active().state, message: () => tab.active().view.message };
}
const run = (change: string) => ({ root: "/repo", change, step: "capability" as const });

describe("usePendingSpecRun for a batch of capability specs", () => {
  it("sends the first message by itself and keeps the rest queued", async () => {
    const { agent, state, message } = fakeAgent();
    useSpecLaunch.getState().request({ tabId: "t1", run: run("a"), message: "Write a", autoSend: true, queue: [{ run: run("b"), message: "Write b" }] });
    await act(async () => root.render(<Probe agent={agent} />));
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ chatId: "t1" }), "Write a", [], true);
    expect(message()).toBe("");
    expect(state.specRun).toEqual({ ...run("a"), workflowPath: "p" });
    expect(state.specQueue.map((queued) => queued.run.change)).toEqual(["b"]);
  });

  it("leaves a single run for the person to send", async () => {
    const { agent, state, message } = fakeAgent();
    useSpecLaunch.getState().request({ tabId: "t1", run: run("a"), message: "Write a" });
    await act(async () => root.render(<Probe agent={agent} />));
    expect(send).not.toHaveBeenCalled();
    expect(message()).toBe("Write a");
    expect(state.specQueue).toEqual([]);
  });
});
