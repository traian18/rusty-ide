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
vi.mock("../../hooks/useSelectableModels", () => ({
  useSelectableModels: () => ({
    options: [{ id: "model-a", name: "Model A" }, { id: "model-b", name: "Model B" }],
    unauthenticatedProviders: [], refreshCatalogue: async () => {}, isRefreshingCatalogue: false,
  }),
}));

import { AGENT_MODEL_SELECTION_STORAGE_KEY } from "../../preferences/agentModelSelection";
import { useWorkspaceStore } from "../../store";
import { AgentTab } from "./AgentTab";
import { BUILTIN_WORKFLOW_PATH } from "./behaviors/starterFlow";
import { useWorkflowRunStore } from "./behaviors/workflowRunStore";

const STARTER_PATH = BUILTIN_WORKFLOW_PATH;
const STARTER_LABEL = "Workflow: Plan, build, verify";
const CHAT_PATH = "/ws/.rusty/chats/old.json";
const WORKSPACE_WORKFLOW_PATH = "/ws/.rusty/workflows/workspace-only.json";
const WORKSPACE_WORKFLOW_NAME = "Workspace-only workflow";
const PROFILE_PATH = "/ws/.rusty/profiles/profile-only.json";
const PROFILE_NAME = "Profile-only behavior";
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
    files[WORKSPACE_WORKFLOW_PATH] = JSON.stringify({
      id: "workspace-only",
      name: WORKSPACE_WORKFLOW_NAME,
      nodes: [
        { id: "input", name: "Input", type: "input" },
        { id: "output", name: "Output", type: "output" },
      ],
      edges: [{ id: "edge", source: "input", target: "output", condition: "on_success" }],
    });
    files[PROFILE_PATH] = JSON.stringify({
      id: "profile-only",
      name: PROFILE_NAME,
      rules: [],
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
    useWorkspaceStore.setState({ rootPath: "/ws", activeModel: "model-a", agentChats: { agent: [] } });
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

  it("exposes workspace workflows but not profiles in the workflow selector", async () => {
    await act(async () => select().click());
    const labels = options().map((option) => option.textContent ?? "");

    expect(labels).toContain(`Workflow: ${WORKSPACE_WORKFLOW_NAME}`);
    expect(labels).not.toContain(PROFILE_NAME);
    expect(labels.every((label) => !label.includes(PROFILE_PATH))).toBe(true);
  });

  it("keeps workflow selection in its chat and starts the next chat as Single agent", async () => {
    await choose(STARTER_PATH);
    expect(select().textContent).toBe(STARTER_LABEL);
    await newChat();
    expect(select().textContent).toBe("Single agent");
  });

  it("keeps the chosen Agent model across global changes, new chats and tab remounts", async () => {
    const modelButton = () => container.querySelector('button[title="Model B"]') as HTMLButtonElement | null;
    await act(async () => (container.querySelector('button[title="Model A"]') as HTMLButtonElement).click());
    await act(async () => [...document.body.querySelectorAll<HTMLElement>('[role="option"]')].find((option) => option.textContent === "Model B")!.click());
    expect(modelButton()).not.toBeNull();
    expect(localStorage.getItem(AGENT_MODEL_SELECTION_STORAGE_KEY)).toBe("model-b");
    act(() => useWorkspaceStore.setState({ activeModel: "model-a" }));
    expect(modelButton()).not.toBeNull();
    await newChat();
    expect(modelButton()).not.toBeNull();
    act(() => root.unmount());
    root = createRoot(container);
    await act(async () => root.render(<AgentTab tab={tab} />));
    await flush();
    expect(modelButton()).not.toBeNull();
  });

  it("shows a saved model as unavailable while the catalogue lacks it, without replacing the choice", async () => {
    localStorage.setItem(AGENT_MODEL_SELECTION_STORAGE_KEY, "other-model");
    act(() => root.unmount());
    root = createRoot(container);
    await act(async () => root.render(<AgentTab tab={tab} />));
    await flush();
    expect(container.querySelector('button[title="other-model (unavailable)"]')).not.toBeNull();
    expect(localStorage.getItem(AGENT_MODEL_SELECTION_STORAGE_KEY)).toBe("other-model");
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
    expect(select().textContent).toBe("Single agent");
  });

  it("restores an explicitly saved workflow only for that chat", async () => {
    files[CHAT_PATH] = JSON.stringify({ ...JSON.parse(files[CHAT_PATH]), workflow: STARTER_PATH });
    await act(async () => {
      [...container.querySelectorAll("div")].filter((div) => div.textContent?.includes("earlier request")).at(-1)!.click();
    });
    await flush();
    expect(select().textContent).toBe(STARTER_LABEL);
    await newChat();
    expect(select().textContent).toBe("Single agent");
  });

  it("restores the failed step and lets the user explicitly start over", async () => {
    const saved = JSON.parse(files[CHAT_PATH]);
    files[CHAT_PATH] = JSON.stringify({ ...saved, workflow: STARTER_PATH, workflowCheckpoint: {
      status: "failed", definition_id: "rusty-ide.builtin.plan-build-verify", failed_step: "build", steps: { plan: { status: "succeeded", output: "saved plan" } },
    } });
    await act(async () => {
      [...container.querySelectorAll("div")].filter((div) => div.textContent?.includes("earlier request")).at(-1)!.click();
    });
    await flush();
    expect(container.textContent).toContain("Your next message resumes Build");
    await act(async () => [...container.querySelectorAll("button")].find(b => b.textContent === "Start over instead")!.click());
    await flush();
    expect(container.textContent).not.toContain("Your next message resumes");
    expect(JSON.parse(files[CHAT_PATH]).workflowCheckpoint).toBeUndefined();
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
