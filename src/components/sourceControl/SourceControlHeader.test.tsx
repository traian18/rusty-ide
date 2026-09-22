// @vitest-environment jsdom
import { act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import SourceControlHeader from "./SourceControlHeader";
import type { GitRepository } from "../../store/types";
vi.mock("../git/GitBranchManager", () => ({ GitBranchManager: () => null }));
let root: Root;
let container: HTMLDivElement;
const repository = (path: string): GitRepository => ({
  id: path, worktreePath: path, gitDir: `${path}/.git`, kind: "worktree", parentId: null,
  submodulePath: null, initialized: true, submoduleState: null,
  head: { mode: "branch", branch: "main", oid: "abc" },
});
const onRepoChange = vi.fn();
function props(repositories: GitRepository[]): ComponentProps<typeof SourceControlHeader> {
  return {
    repositories, subprojects: repositories.map((repo) => repo.worktreePath),
    activeRepo: repositories[0].worktreePath, activeRepository: repositories[0], rootPath: "/workspace",
    gitStatus: { isRepo: true, currentBranch: "main", staged: [], unstaged: [] },
    headLabel: "main", disableBranchOnlyActions: false, submoduleActionLoading: null,
    localBranches: ["main"], remoteBranches: [], showBranchPopover: false,
    onRepoChange, onInitSubmodule: vi.fn(), onUpdateSubmodule: vi.fn(), onSyncSubmodule: vi.fn(),
    onOpenGraph: vi.fn(), onToggleBranchPopover: vi.fn(), onCloseBranchPopover: vi.fn(),
    onAbortPending: async () => {}, onCheckoutBranch: async () => {}, onCreateBranch: async () => {},
    onDeleteBranch: async () => {}, onMergeBranch: async () => {}, onRebaseBranch: async () => {},
  };
}
beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  onRepoChange.mockClear();
  container = document.createElement("div"); document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });

it("shows only the branch control for a single repository", async () => {
  await act(async () => root.render(<SourceControlHeader {...props([repository("/workspace/api")])} />));
  expect(container.textContent).toContain("main");
  expect(container.querySelector("#source-control-repository")).toBeNull();
  expect(container.textContent).not.toContain("detached");
});

it("uses the shared dropdown to show and select discovered repositories", async () => {
  await act(async () => root.render(<SourceControlHeader {...props([
    repository("/workspace/services/api"), repository("/workspace/infrastructure"),
  ])} />));
  expect(container.querySelector("select")).toBeNull();
  const button = container.querySelector<HTMLButtonElement>("#source-control-repository")!;
  expect(button.textContent).toContain("services/api");
  expect(button.className).toContain("bg-[var(--accent-bg)]/35");
  expect(button.className).toContain("text-[var(--accent-color)]");
  expect(button.className).toContain("font-mono");
  expect(button.className).toContain("text-[10px]");
  expect(button.className).toContain("font-bold");
  expect(button.querySelector("svg")).not.toBeNull();
  await act(async () => button.click());
  const options = Array.from(document.querySelectorAll<HTMLElement>('[role="option"]'));
  expect(options.map((option) => option.textContent)).toEqual([
    "services/api (worktree)",
    "infrastructure (worktree)",
  ]);
  await act(async () => options[1].click());
  expect(onRepoChange).toHaveBeenCalledWith("/workspace/infrastructure");
});
