// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.hoisted(() => vi.fn());
const run = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke, Channel: class {} }));
vi.mock("../../harness", () => ({ harness: { run, releaseSession: vi.fn(async () => {}) } }));
vi.mock("../../store/resolveExecutionProvider", () => ({
  resolveExecutionProvider: () => ({ ok: true, provider: { id: "p", name: "P", models: [] } }),
}));

import { AGENT_WORKFLOW_OPT_OUT_STORAGE_KEY } from "../../preferences/agentWorkflowDefault";
import { useWorkspaceStore } from "../../store";
import { AgentTab } from "./AgentTab";
import { STARTER_WORKFLOW_ID } from "./behaviors/starterFlow";
import { useWorkflowRunStore } from "./behaviors/workflowRunStore";

const STARTER_PATH = `/ws/.rusty/workflows/${STARTER_WORKFLOW_ID}.json`;
const STARTER_LABEL = "Workflow: Plan, build, verify";
const CHAT_PATH = "/ws/.rusty/chats/old.json";
const files: Record<string, string> = {};
const writes: string[] = [];

async function flush(ms = 0) {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  });
}

describe("Agent chat and the starter flow", () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;
  const tab = { id: "agent", type: "agent", title: "Agent", status: "idle", dirty: false } as never;
  const select = () => container.querySelector("#agent-workflow-select") as HTMLButtonElement;
  const options = () => [...document.body.querySelectorAll<HTMLElement>('[role="option"]')];
  const LABELS: Record<string, string> = { "": "Single agent", [STARTER_PATH]: STARTER_LABEL };
  const choose = async (value: string) => {
    await act(async () => select().click());
    await act(async () => options().find((option) => option.textContent === LABELS[value])!.click());
    await flush();
  };
  const newChat = async () => {
    await act(async () => (container.querySelector('[title="New chat"]') as HTMLButtonElement).click());
    await flush();
  };

  beforeEach(async () => {
    localStorage.clear();
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
    Element.prototype.scrollIntoView = vi.fn();
    for (const key of Object.keys(files)) delete files[key];
    writes.length = 0;
    // A saved conversation from before: it followed no workflow.
    files[CHAT_PATH] = JSON.stringify({
      tabId: "agent",
      messages: [{ id: "m1", role: "user", content: "earlier request", timestamp: "2026-09-29" }],
      savedAt: "2026-09-29T10:00:00Z",
    });
    invoke.mockReset();
    invoke.mockImplementation(async (command: string, args: Record<string, unknown>) => {
      switch (command) {
        case "get_directory_structure": {
          const dir = `${String(args.rootDir)}/`;
          return Object.keys(files)
            .filter((path) => path.startsWith(dir))
            .map((path) => ({ name: path.slice(dir.length), path, is_dir: false }));
        }
        case "read_file_disk": {
          const content = files[String(args.path)];
          if (content === undefined) throw new Error("not found");
          return content;
        }
        case "write_file_disk":
          writes.push(String(args.path));
          files[String(args.path)] = String(args.content);
          return undefined;
        case "save_chat_history":
          return "/ws/.rusty/chats/new.json";
        default:
          return undefined;
      }
    });
    run.mockReset();
    run.mockImplementation(() => ({ runId: "r", started: Promise.resolve(), done: new Promise(() => {}), cancel: vi.fn() }));
    useWorkflowRunStore.setState({ agentRequest: undefined, runs: {} });
    useWorkspaceStore.setState({ rootPath: "/ws", agentChats: { agent: [] } });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => root.render(<AgentTab tab={tab} />));
    await flush();
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  it("gives an empty workspace the starter flow and follows it in the first chat", async () => {
    expect(writes).toEqual(["/ws/.rusty/profiles/plan.json", "/ws/.rusty/profiles/build.json", STARTER_PATH]);
    expect(select().textContent).toBe(STARTER_LABEL);
    const steps = container.querySelector('ol[aria-label="Workflow steps"]')?.textContent ?? "";
    for (const step of ["Plan", "Build", "Verify"]) expect(steps).toContain(step);
  });

  it("remembers Single agent as an opt-out for new chats, and a workflow choice clears it", async () => {
    await choose("");
    expect(select().textContent).toBe("Single agent");
    expect(localStorage.getItem(AGENT_WORKFLOW_OPT_OUT_STORAGE_KEY)).toBe("true");
    await newChat();
    expect(select().textContent).toBe("Single agent");

    await choose(STARTER_PATH);
    expect(localStorage.getItem(AGENT_WORKFLOW_OPT_OUT_STORAGE_KEY)).toBeNull();
    await newChat();
    expect(select().textContent).toBe(STARTER_LABEL);
  });

  it("leaves a chat loaded from history as it was saved", async () => {
    await act(async () => {
      [...container.querySelectorAll("div")]
        .filter((div) => div.textContent?.includes("earlier request"))
        .at(-1)!
        .click();
    });
    await flush();
    expect(select().textContent).toBe("Single agent");

    await newChat();
    expect(select().textContent).toBe(STARTER_LABEL);
  });

  it("does not pull a conversation in progress onto the flow when the tab remounts", async () => {
    // The conversation lives in the store, so it outlasts the tab's own state:
    // a remounted tab starts with no chosen workflow but real messages.
    act(() => root.unmount());
    useWorkspaceStore.setState({
      agentChats: { agent: [{ id: "u1", role: "user", content: "hello", timestamp: "2026-09-30" } as never] },
    });
    root = createRoot(container);
    await act(async () => root.render(<AgentTab tab={tab} />));
    await flush();
    expect(select().textContent).toBe("Single agent");
  });
});
