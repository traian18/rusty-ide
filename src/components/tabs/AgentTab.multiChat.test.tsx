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
import { answerCatalogCommand } from "../../test/fakeWorkflowCatalog";
import { useWorkflowRunStore } from "./behaviors/workflowRunStore";
import { useChatStore } from "./agentTab/chats/chatStore";

const files: Record<string, string> = {};

async function flush(ms = 0) {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  });
}

interface FakeRun {
  input: { tabId: string; message: string };
  host: { askQuestion(question: unknown): Promise<string> };
  onEvent(event: unknown): void;
  cancel: ReturnType<typeof vi.fn>;
  finish(response: string): void;
}

describe("Agent tab with several chats", () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;
  const runs: FakeRun[] = [];
  const tab = { id: "agent", type: "agent", title: "Agent", status: "idle", dirty: false } as never;
  const pills = () => [...container.querySelectorAll<HTMLElement>('[role="tab"][data-chat-id]')];
  const shownMessages = () => useWorkspaceStore.getState().agentChats[useChatStore.getState().tabs.agent.activeChatId] ?? [];

  async function send(text: string) {
    const runsBefore = run.mock.calls.length;
    const textarea = container.querySelector("textarea") as HTMLTextAreaElement;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(textarea, text);
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });
    for (let tries = 0; tries < 200 && run.mock.calls.length === runsBefore; tries++) await flush(10);
  }
  const newChat = () => act(async () => container.querySelector<HTMLButtonElement>("#agent-new-chat")!.click());
  const selectPill = (at: number) => act(async () => pills()[at].click());

  beforeEach(async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
    Element.prototype.scrollIntoView = vi.fn();
    for (const key of Object.keys(files)) delete files[key];
    runs.length = 0;
    let saved = 0;
    invoke.mockReset();
    invoke.mockImplementation(async (command: string, args: Record<string, unknown>) => {
      switch (command) {
        case "behavior_catalog":
        case "behavior_catalog_workflow":
          return answerCatalogCommand(files, command, args);
        case "read_file_disk": {
          const content = files[String(args.path)];
          if (content === undefined) throw new Error("not found");
          return content;
        }
        case "write_file_disk":
          files[String(args.path)] = String(args.content);
          return undefined;
        case "save_chat_history": {
          const path = `/ws/.rusty/chats/chat-${++saved}.json`;
          files[path] = String(args.content);
          return path;
        }
        default:
          return undefined;
      }
    });
    run.mockReset();
    run.mockImplementation((_capability: string, input: FakeRun["input"], host: FakeRun["host"], onEvent: FakeRun["onEvent"]) => {
      let resolve!: (outcome: unknown) => void;
      const done = new Promise((r) => { resolve = r; });
      const cancel = vi.fn(() => resolve({ status: "cancelled" }));
      runs.push({
        input, host, onEvent, cancel,
        finish: (response) => resolve({ status: "completed", result: { response, modifiedFiles: [], subagents: [] } }),
      });
      return { runId: `r${runs.length}`, started: Promise.resolve(), done, cancel };
    });
    useWorkflowRunStore.setState({ agentRequest: undefined, runs: {}, chatRuns: {} });
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

  it("runs two chats at once, each with its own transcript, session, usage and status", async () => {
    await send("first task");
    expect(runs).toHaveLength(1);
    expect(runs[0].input.tabId).toBe("agent");

    // The first chat still runs; a new one opens beside it and can send at once.
    await newChat();
    expect(pills()).toHaveLength(2);
    expect(shownMessages()).toHaveLength(0);
    await send("second task");
    expect(runs).toHaveLength(2);
    const [first, second] = runs;
    expect(second.input.tabId).not.toBe(first.input.tabId);

    // Each run writes to its own chat, whichever is shown.
    await act(async () => {
      first.onEvent({ kind: "token", content: "working on the first", messageId: "a" });
      first.onEvent({ kind: "usage", usage: { prompt_tokens: 11, completion_tokens: 1, total_tokens: 12 } });
      second.onEvent({ kind: "usage", usage: { prompt_tokens: 50, completion_tokens: 5, total_tokens: 55 } });
    });
    await flush(150);
    const chats = useChatStore.getState().chats;
    expect(chats[first.input.tabId].runUsage).toMatchObject({ total_tokens: 12 });
    expect(chats[second.input.tabId].runUsage).toMatchObject({ total_tokens: 55 });
    expect(pills().map((pill) => pill.dataset.status)).toEqual(["running", "running"]);

    const messagesOf = (chatId: string) => (useWorkspaceStore.getState().agentChats[chatId] ?? []).map((m) => m.content);
    expect(messagesOf(first.input.tabId)).toContain("first task");
    expect(messagesOf(first.input.tabId).join("\n")).toContain("working on the first");
    expect(messagesOf(first.input.tabId)).not.toContain("second task");
    expect(messagesOf(second.input.tabId)).toContain("second task");
    expect(messagesOf(second.input.tabId).join("\n")).not.toContain("working on the first");

    // Switching back shows the first chat as it went on.
    await selectPill(0);
    expect(container.textContent).toContain("working on the first");
    expect(shownMessages().map((m) => m.content)).not.toContain("second task");

    // The second finishes while the first is shown; the first keeps running.
    await act(async () => second.finish("second done"));
    await flush();
    expect(pills().map((pill) => pill.dataset.status)).toEqual(["running", "idle"]);
    expect(messagesOf(second.input.tabId)).toContain("second done");
    expect(messagesOf(first.input.tabId)).not.toContain("second done");
    expect(useWorkspaceStore.getState().busyAgentTabIds.agent).toBe(true);
  });

  it("keeps a question in the chat that asked it, and stopping one chat leaves the other running", async () => {
    await send("first task");
    await newChat();
    await send("second task");
    const [first, second] = runs;

    // The first chat (not shown) asks; the shown one's box has no question.
    let answer: Promise<string> | undefined;
    await act(async () => {
      answer = first.host.askQuestion({ requestId: "q1", question: "Which file?", options: [{ label: "a.ts" }, { label: "b.ts" }] });
    });
    expect(pills().map((pill) => pill.dataset.status)).toEqual(["input", "running"]);
    expect(container.textContent).not.toContain("Which file?");
    await selectPill(0);
    expect(container.textContent).toContain("Which file?");

    // Stop the shown (first) chat: its question is released, the second chat runs on.
    const stop = [...container.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.trim() === "STOP");
    await act(async () => stop!.click());
    await flush();
    await expect(answer).resolves.toBe("");
    expect(first.cancel).toHaveBeenCalled();
    expect(second.cancel).not.toHaveBeenCalled();
    expect(pills().map((pill) => pill.dataset.status)).toEqual(["idle", "running"]);
  });

  it("closing a running chat stops it and drops its late events; the tab keeps one chat", async () => {
    await send("first task");
    await newChat();
    await send("second task");
    const [first, second] = runs;
    const closed = second.input.tabId;

    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label^="Close second task"]')!.click());
    await flush();
    expect(second.cancel).toHaveBeenCalled();
    expect(pills()).toHaveLength(1);
    expect(useChatStore.getState().chats[closed]).toBeUndefined();
    expect(useWorkspaceStore.getState().agentChats[closed]).toBeUndefined();

    await act(async () => second.onEvent({ kind: "token", content: "too late", messageId: "x" }));
    await flush(150);
    expect(useWorkspaceStore.getState().agentChats[closed]).toBeUndefined();
    expect(first.cancel).not.toHaveBeenCalled();
    expect(shownMessages().map((m) => m.content)).toContain("first task");
  });

  it("opens a saved chat in a new chat while the shown one runs, and switches to it when it is already open", async () => {
    files["/ws/.rusty/chats/old.json"] = JSON.stringify({
      messages: [{ id: "m1", role: "user", content: "earlier request", timestamp: "2026-09-29" }],
      savedAt: "2026-09-29T10:00:00Z",
    });
    invoke.mockImplementation(((original) => async (command: string, args: Record<string, unknown>) => {
      if (command === "get_directory_structure") {
        return Object.keys(files).filter((path) => path.startsWith("/ws/.rusty/chats/")).map((path) => ({ name: path.split("/").pop(), path, is_dir: false }));
      }
      return original(command, args);
    })(invoke.getMockImplementation()!));
    await act(async () => container.querySelector<HTMLButtonElement>('[title="Refresh"]')!.click());
    await flush();
    await send("current task");

    const historyRow = () => [...container.querySelectorAll("p")].find((p) => p.textContent === "earlier request")!.parentElement!;
    await act(async () => historyRow().click());
    await flush();
    expect(pills()).toHaveLength(2);
    expect(shownMessages().map((m) => m.content)).toEqual(["earlier request"]);
    expect(runs[0].cancel).not.toHaveBeenCalled();

    await selectPill(0);
    await act(async () => historyRow().click());
    await flush();
    expect(pills()).toHaveLength(2);
    expect(shownMessages().map((m) => m.content)).toEqual(["earlier request"]);
  });
});
