// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke, Channel: class {} }));
vi.mock("../../harness", () => ({ harness: { run: vi.fn(), releaseSession: vi.fn(async () => {}) } }));
vi.mock("../../store/resolveExecutionProvider", () => ({
  resolveExecutionProvider: () => ({ ok: true, provider: { id: "p", name: "P", models: [] } }),
}));

import { useWorkspaceStore } from "../../store";
import { AgentTab } from "./AgentTab";

const files: Record<string, string> = {};

const savedChat = (savedAt: string, ...prompts: string[]) =>
  JSON.stringify({
    tabId: "agent",
    savedAt,
    messages: prompts.flatMap((content, index) => [
      { id: `u${index}`, role: "user", content, timestamp: savedAt },
      { id: `a${index}`, role: "assistant", content: `answer to ${content}`, timestamp: savedAt },
    ]),
  });

const flush = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

describe("Agent chat: the up arrow offers earlier prompts", () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;
  const tab = { id: "agent", type: "agent", title: "Agent", status: "idle", dirty: false } as never;

  const box = () => container.querySelector("textarea") as HTMLTextAreaElement;
  const rows = () => [...container.querySelectorAll('[aria-label="Recent prompts"] [role="option"]')].map((row) => row.textContent);
  const pressUp = () =>
    act(async () => {
      box().dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true, cancelable: true }));
    });
  const open = async (current: { role: string; content: string }[] = []) => {
    useWorkspaceStore.setState({
      rootPath: "/ws",
      agentChats: { agent: current.map((message, index) => ({ id: `c${index}`, timestamp: "2026-10-01", ...message })) as never },
    });
    root = createRoot(container);
    await act(async () => root.render(<AgentTab tab={tab} />));
    await flush();
    await flush();
  };

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
    for (const key of Object.keys(files)) delete files[key];
    invoke.mockReset();
    invoke.mockImplementation(async (command: string, args: Record<string, unknown>) => {
      if (command === "get_directory_structure") {
        const dir = `${String(args.rootDir)}/`;
        return Object.keys(files).filter((path) => path.startsWith(dir)).map((path) => ({ name: path.slice(dir.length), path, is_dir: false }));
      }
      if (command === "read_file_disk") {
        const content = files[String(args.path)];
        if (content === undefined) throw new Error("not found");
        return content;
      }
      return undefined;
    });
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  it("takes this chat's prompts first, newest next to the box", async () => {
    await open([
      { role: "user", content: "one" },
      { role: "assistant", content: "reply" },
      { role: "user", content: "two" },
    ]);
    await pressUp();
    expect(rows()).toEqual(["one", "two"]);
  });

  it("fills up to five from earlier chats when this one has fewer, newest chat first", async () => {
    files["/ws/.rusty/chats/a.json"] = savedChat("2026-09-28T10:00:00Z", "oldest-1", "oldest-2");
    files["/ws/.rusty/chats/b.json"] = savedChat("2026-09-30T10:00:00Z", "mid-1", "mid-2", "mid-3");
    await open([{ role: "user", content: "now" }]);
    await pressUp();
    // Oldest at the top: now was sent last, then mid-3, mid-2, mid-1, then oldest-2.
    expect(rows()).toEqual(["oldest-2", "mid-1", "mid-2", "mid-3", "now"]);
  });

  it("works in a brand new chat, from the saved ones alone", async () => {
    files["/ws/.rusty/chats/a.json"] = savedChat("2026-09-28T10:00:00Z", "fix the build", "add tests");
    await open();
    await pressUp();
    expect(rows()).toEqual(["fix the build", "add tests"]);
  });

  it("loads new-workspace history without reopening the prior active chat", async () => {
    files["/old/.rusty/chats/old.json"] = savedChat("2026-09-28T10:00:00Z", "old workspace prompt");
    files["/new/.rusty/chats/new.json"] = savedChat("2026-09-30T10:00:00Z", "new workspace prompt");
    await open([{ role: "user", content: "old active message" }]);

    await act(async () => {
      useWorkspaceStore.setState({ rootPath: "/old" });
    });
    await flush();
    const oldChat = [...container.querySelectorAll(".cursor-pointer")].find((element) => element.textContent?.includes("old workspace prompt")) as HTMLElement;
    await act(async () => oldChat.click());

    const loadWorkspaceData = vi.fn().mockResolvedValue(undefined);
    const saveSecureConfig = vi.fn().mockResolvedValue(undefined);
    useWorkspaceStore.setState({ loadWorkspaceData, saveSecureConfig } as never);
    await act(async () => {
      useWorkspaceStore.getState().setRootPath("/new");
    });
    await flush();
    await flush();

    expect(container.textContent).toContain("new workspace prompt");
    expect(container.textContent).not.toContain("old active message");
    expect(container.textContent).not.toContain("old workspace prompt");
    expect(useWorkspaceStore.getState().agentChats.agent).toEqual([]);
  });

  it("opens nothing when there is no earlier prompt anywhere", async () => {
    await open();
    await pressUp();
    expect(container.querySelector('[aria-label="Recent prompts"]')).toBeNull();
  });
});
