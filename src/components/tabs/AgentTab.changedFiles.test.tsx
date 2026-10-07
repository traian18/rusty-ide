// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke, Channel: class {} }));
vi.mock("../../harness", () => ({ harness: { run: vi.fn(), releaseSession: vi.fn(async () => {}) } }));
vi.mock("../../store/resolveExecutionProvider", () => ({
  resolveExecutionProvider: () => ({ ok: true, provider: { id: "p", name: "P", models: [] } }),
}));

import { useWorkspaceStore } from "../../store";
import { AgentTab } from "./AgentTab";

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
let previous: ReturnType<typeof useWorkspaceStore.getState>;
let scrollDescriptor: PropertyDescriptor | undefined;
const openTab = vi.fn();
const flush = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });

beforeEach(() => {
  previous = useWorkspaceStore.getState();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  scrollDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollIntoView");
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value: vi.fn() });
  openTab.mockReset();
  invoke.mockReset();
  invoke.mockImplementation(async (command: string) => {
    if (command === "git_discover_workspace_repositories") return [
      { id: "nested", worktree_path: "/workspace/rusty-ide", head: { type: "unborn" } },
    ];
    if (command === "get_directory_structure") return [{ name: "saved.json", path: "/workspace/.rusty/chats/saved.json", is_dir: false }];
    if (command === "read_file_disk") return JSON.stringify({
      savedAt: "2026-01-01", messages: [{ id: "u", role: "user", content: "Modify nested file", timestamp: "2026-01-01" }],
      modifiedFiles: ["/workspace/rusty-ide/src/file.ts"],
    });
    return undefined;
  });
  useWorkspaceStore.setState({ rootPath: "/workspace", repositories: [
    { id: "root", worktreePath: "/workspace" },
    { id: "nested", worktreePath: "/workspace/rusty-ide" },
  ] as never, agentChats: { agent: [] }, openTab });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  useWorkspaceStore.setState(previous, true);
  vi.restoreAllMocks();
  if (scrollDescriptor) Object.defineProperty(HTMLElement.prototype, "scrollIntoView", scrollDescriptor);
  else Reflect.deleteProperty(HTMLElement.prototype, "scrollIntoView");
  invoke.mockReset();
  vi.unstubAllGlobals();
});

it.each([false, true])("opens the actual modified-file header against the nested repository (discovery needed: %s)", async (discoveryNeeded) => {
  if (discoveryNeeded) useWorkspaceStore.setState({ repositories: [] });
  await act(async () => root.render(<AgentTab tab={{ id: "agent", type: "agent", title: "Agent", status: "idle", dirty: false } as never} />));
  await flush();
  const historyToggle = container.querySelector<HTMLButtonElement>('button[title="Show history"]');
  if (historyToggle) await act(async () => historyToggle.click());
  const preview = [...container.querySelectorAll("p")].find((node) => node.textContent === "Modify nested file");
  expect(preview).toBeDefined();
  await act(async () => preview!.click());
  await flush();
  const control = [...container.querySelectorAll("button")].find((node) => node.textContent === "file.ts");
  expect(control).toBeDefined();
  await act(async () => control!.click());
  expect(openTab.mock.calls[0]?.[0].repoPath).toBe("/workspace/rusty-ide");
  expect(openTab).toHaveBeenCalledWith({
    type: "git-diff", repoPath: "/workspace/rusty-ide", path: "/workspace/rusty-ide/src/file.ts",
    diffType: "unstaged", title: "file.ts (Workspace)",
  });
});
