// @vitest-environment jsdom
/**
 * Renders the real FileTree against a small in-memory store. Guards the
 * behavior that a rewrite of FileTree.tsx once dropped without anyone
 * noticing: keyboard navigation (the tree must be focusable and handle
 * arrows/Enter) and the accent-colored folder icons.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { store } = vi.hoisted(() => ({ store: { current: null as any } }));

vi.mock("../store", async () => {
  const { create } = await import("zustand");
  store.current = create<any>((set) => ({
    rootPath: "/ws",
    expandedPaths: {} as Record<string, boolean>,
    setPathExpanded: (path: string, open: boolean) => set((s: any) => ({ expandedPaths: { ...s.expandedPaths, [path]: open } })),
    gitStatus: null,
    repositories: [],
    statusByRepositoryId: {},
    revealPath: null,
    clearRevealPath: () => set({ revealPath: null }),
    revealFileInTree: vi.fn(),
    openTab: vi.fn(),
  }));
  return { useWorkspaceStore: store.current };
});
vi.mock("../store/tabSelectors", () => ({ selectActiveFilePath: () => null, selectActiveTabId: () => null }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("./filetree/FileTreePresenter", () => ({ refreshTree: vi.fn(), fileTreePresenter: { deleteItems: vi.fn() } }));
vi.mock("./git/GitPresenter", () => ({ gitPresenter: {} }));
vi.mock("../services/fileTypeService", () => ({ FileIcon: () => <span data-file-icon /> }));

import { FileTree, type FileEntry } from "./FileTree";

const ENTRIES: FileEntry[] = [
  {
    name: "src",
    path: "/ws/src",
    is_dir: true,
    children: [{ name: "main.ts", path: "/ws/src/main.ts", is_dir: false }],
  },
  { name: "README.md", path: "/ws/README.md", is_dir: false },
];

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  store.current.setState({ expandedPaths: {} });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root.render(<FileTree entries={ENTRIES} />));
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const tree = () => container.querySelector<HTMLElement>('[role="tree"]')!;
const row = (path: string) => container.querySelector<HTMLElement>(`[data-file-path="${path}"]`);
const press = (key: string) => act(() => void tree().dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true })));
const selectedPath = () => container.querySelector('[aria-selected="true"]')?.getAttribute("data-file-path");

describe("FileTree", () => {
  it("is keyboard-focusable", () => {
    expect(tree().tabIndex).toBe(0);
  });

  it("navigates with the arrow keys and expands/collapses folders", () => {
    press("ArrowDown");
    expect(selectedPath()).toBe("/ws/src");

    press("ArrowRight");
    expect(store.current.getState().expandedPaths["/ws/src"]).toBe(true);
    expect(row("/ws/src/main.ts")).not.toBeNull();

    press("ArrowDown");
    expect(selectedPath()).toBe("/ws/src/main.ts");

    press("ArrowLeft");
    expect(selectedPath()).toBe("/ws/src");

    press("ArrowLeft");
    expect(store.current.getState().expandedPaths["/ws/src"]).toBe(false);

    press("ArrowDown");
    expect(selectedPath()).toBe("/ws/README.md");
  });

  it("opens the focused file with Enter", () => {
    press("ArrowDown");
    press("ArrowDown");
    press("Enter");
    expect(store.current.getState().openTab).toHaveBeenCalledWith({ type: "file", path: "/ws/README.md", title: "README.md" });
  });

  it("draws folder icons in the accent color", () => {
    const icon = row("/ws/src")!.querySelector("[data-folder-icon]");
    expect(icon?.className).toContain("text-[var(--accent-color)]");
  });
});
