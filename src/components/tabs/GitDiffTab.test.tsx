// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const revealFileInTree = vi.hoisted(() => vi.fn());

vi.mock("../../store", () => ({
  useWorkspaceStore: (selector: (state: unknown) => unknown) => selector({
    typographyPreferences: { editorFontSize: 14 },
    revealFileInTree,
  }),
}));
vi.mock("@monaco-editor/react", () => ({
  DiffEditor: () => <div data-testid="diff-editor" />,
}));
vi.mock("./GitDiffContent", () => ({
  loadGitDiffContent: vi.fn(async () => ({ original: "old", modified: "new" })),
}));
vi.mock("../../services/fileTypeService", () => ({
  getFileTypeDetails: () => ({ language: "typescript" }),
}));
vi.mock("../../editor/monacoOptions", () => ({
  createMonacoDiffOptions: () => ({}),
}));
vi.mock("../git/gitErrors", () => ({ gitErrorMessage: () => "Git error" }));

import { GitDiffTab } from "./GitDiffTab";

let container: HTMLDivElement;
let root: Root;

const tab = {
  id: "diff",
  type: "git-diff" as const,
  title: "file.ts (Workspace)",
  path: "/workspace/rusty-ide/src/file.ts",
  repoPath: "/workspace/rusty-ide",
  diffType: "unstaged" as const,
};

describe("GitDiffTab", () => {
  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    revealFileInTree.mockReset();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => root.render(<GitDiffTab tab={tab} isActive={true} />));
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  it("renders loading and then the diff editor", async () => {
    expect(container.textContent).toContain("Loading Git diff changes...");
    expect(container.querySelector('[data-testid="diff-editor"]')).toBeNull();

    await act(async () => {
      await Promise.resolve();
    });

    expect(container.textContent).not.toContain("Loading Git diff changes...");
    expect(container.querySelector('[data-testid="diff-editor"]')).not.toBeNull();
  });

  it("reveals the full diff path in the file tree", () => {
    const revealButton = container.querySelector<HTMLButtonElement>('button[title="Reveal in File Tree"]');

    expect(revealButton).not.toBeNull();
    expect(container.textContent).toContain(tab.path);
    expect(container.querySelector('button[title="Auto: automatically switch based on screen width"]')).not.toBeNull();

    act(() => revealButton!.click());

    expect(revealFileInTree).toHaveBeenCalledWith(tab.path);
  });
});
