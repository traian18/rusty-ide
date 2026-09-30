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

import { useWorkspaceStore } from "../../store";
import { AgentTab } from "./AgentTab";
import { useWorkflowRunStore } from "./behaviors/workflowRunStore";

const FLOW_PATH = "/ws/.rusty/workflows/flow.json";
const FLOW = {
  schema_version: 1,
  id: "flow",
  revision: 1,
  name: "Plan and build",
  nodes: [
    { id: "input", name: "Input", type: "input" },
    { id: "build", name: "Build", type: "agent" },
  ],
  edges: [{ id: "e", source: "input", target: "build", condition: "on_success" }],
};
const CHAT_PATH = "/ws/.rusty/chats/old.json";
const files: Record<string, string> = {};
const writes: Array<{ path: string; content: string }> = [];

async function flush(ms = 0) {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  });
}

describe("Agent chat workflows", () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;
  const tab = { id: "agent", type: "agent", title: "Agent", status: "idle", dirty: false } as never;
  // The app's CustomSelect: a button that opens a listbox in a portal.
  const select = () => container.querySelector("#agent-workflow-select") as HTMLButtonElement;
  const options = () => [...document.body.querySelectorAll<HTMLElement>('[role="option"]')];
  const LABELS: Record<string, string> = { "": "Single agent", [FLOW_PATH]: "Workflow: Plan and build" };
  const choose = async (value: string) => {
    await act(async () => select().click());
    await act(async () => options().find((option) => option.textContent === LABELS[value])!.click());
    await flush();
  };

  beforeEach(async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
    Element.prototype.scrollIntoView = vi.fn();
    for (const key of Object.keys(files)) delete files[key];
    writes.length = 0;
    files[FLOW_PATH] = JSON.stringify(FLOW);
    files[CHAT_PATH] = JSON.stringify({
      tabId: "agent",
      messages: [{ id: "m1", role: "user", content: "earlier request", timestamp: "2026-09-29" }],
      savedAt: "2026-09-29T10:00:00Z",
      workflow: FLOW_PATH,
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
          writes.push({ path: String(args.path), content: String(args.content) });
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

  it("offers the picker with the workspace's workflows", async () => {
    await act(async () => select().click());
    expect(options().map((option) => option.textContent)).toEqual(["Single agent", "Workflow: Plan and build"]);
    await act(async () => select().click());
    expect(container.textContent).toContain("Each message runs one agent loop.");
  });

  it("restores a saved chat's workflow and forgets it for a new chat", async () => {
    // History entries are clickable rows, not buttons.
    await act(async () => {
      [...container.querySelectorAll("div")]
        .filter((div) => div.textContent?.includes("earlier request"))
        .at(-1)!
        .click();
    });
    await flush();
    expect(select().textContent).toBe("Workflow: Plan and build");
    expect(container.querySelector('[data-testid="workflow-chip"]')?.textContent).toContain("Plan and build");
    expect(container.querySelector('ol[aria-label="Workflow steps"]')?.textContent).toContain("Build");

    // Changing it in a saved chat saves the chat right away.
    await choose("");
    expect(JSON.parse(files[CHAT_PATH]).workflow).toBeUndefined();
    await choose(FLOW_PATH);
    expect(JSON.parse(files[CHAT_PATH]).workflow).toBe(FLOW_PATH);

    await act(async () => (container.querySelector('[title="New chat"]') as HTMLButtonElement)?.click());
    await flush();
    expect(select().textContent).toBe("Single agent");
  });

  it("adopts a workflow handed over by the Behaviors tab", async () => {
    await act(async () => {
      useWorkflowRunStore.getState().requestAgentWorkflow(FLOW_PATH);
    });
    await flush();
    expect(select().textContent).toBe("Workflow: Plan and build");
    expect(useWorkflowRunStore.getState().agentRequest).toBeUndefined();
  });

  it("sends the chat's workflow with the message and shows it running", async () => {
    await choose(FLOW_PATH);
    const textarea = container.querySelector("textarea") as HTMLTextAreaElement;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(textarea, "add password reset");
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });
    await flush();

    expect(run).toHaveBeenCalledTimes(1);
    const [capability, input] = run.mock.calls[0];
    expect(capability).toBe("agent_chat");
    expect(input.workflow).toEqual({ definition: FLOW, input: { request: "add password reset", attachments: [] } });
    expect(useWorkflowRunStore.getState().runs.flow?.status).toBe("running");
    expect(container.textContent).toContain("Starting the workflow…");
    expect(select().disabled).toBe(true);

    // Step progress from the run: the bar names the current step, the chat
    // marks where the agent step's output begins, the status line names it.
    const onEvent = run.mock.calls[0][3] as (event: unknown) => void;
    await act(async () => {
      onEvent({ kind: "workflow_step", workflowId: "flow", nodeId: "input", name: "Input", status: "running", attempt: 1 });
      onEvent({ kind: "workflow_step", workflowId: "flow", nodeId: "input", name: "Input", status: "succeeded", attempt: 1 });
      onEvent({ kind: "workflow_step", workflowId: "flow", nodeId: "build", name: "Build", status: "running", attempt: 1 });
      onEvent({ kind: "token", content: "Reading the auth module", messageId: "m1" });
    });
    await flush();
    expect(container.textContent).toContain("Running step 2 of 2: Build");
    expect(container.textContent).toContain("▶ Build");
    expect(container.textContent).not.toContain("▶ Input");
    expect(container.textContent).toContain("Build · Generating response…");
    // The new conversation is saved with its workflow.
    expect(savedWorkflow()).toBe(FLOW_PATH);
  });
});

function savedWorkflow(): string | undefined {
  const call = invoke.mock.calls.find(([command]) => command === "save_chat_history");
  return call ? JSON.parse(String((call[1] as { content: string }).content)).workflow : undefined;
}
