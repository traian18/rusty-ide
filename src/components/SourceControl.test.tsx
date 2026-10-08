// @vitest-environment jsdom
import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const { store } = vi.hoisted(() => ({ store: { current: null as any } }));

vi.mock("../store", async () => {
  const { create } = await import("zustand");
  store.current = create<any>(() => ({
    rootPath: "/workspace",
    gitStatus: null,
    statusByRepositoryId: {},
    loadGitStatus: vi.fn().mockResolvedValue(undefined),
    openTab: vi.fn(),
    lastRename: null,
    setLastRename: vi.fn(),
    repositoriesLoading: true,
    repositories: [],
    activeRepositoryId: null,
    setActiveRepositoryId: vi.fn(),
    discoverRepositories: vi.fn(),
    initSubmodule: vi.fn(),
    updateSubmodule: vi.fn(),
    syncSubmodule: vi.fn(),
    gitHistoryExpanded: false,
    setGitHistoryExpanded: vi.fn(),
  }));
  return { useWorkspaceStore: store.current };
});

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn().mockResolvedValue(undefined) }));

import { SourceControl } from "./SourceControl";

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.append(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

it("shows a spinner while discovering repositories", async () => {
  await act(async () => {
    root = createRoot(container);
    root.render(<SourceControl /> as ReactElement);
  });

  const loadingState = container.querySelector('[role="status"]');
  expect(loadingState).not.toBeNull();
  expect(loadingState?.textContent).toContain("Finding repositories…");
  expect(loadingState?.querySelector(".animate-spin")).not.toBeNull();
  expect(loadingState?.querySelector('[aria-hidden="true"]')).not.toBeNull();
});
