import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  invoke: vi.fn().mockResolvedValue({ stashed: false, restored: false }),
  resetForBranchChange: vi.fn(), loadGitStatus: vi.fn(), setFileTree: vi.fn(), notify: vi.fn(),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("../../store", () => ({ useWorkspaceStore: { getState: () => ({
  rootPath: "/workspace", resetForBranchChange: mocks.resetForBranchChange,
  loadGitStatus: mocks.loadGitStatus, setFileTree: mocks.setFileTree,
}) } }));
vi.mock("../../notificationStore", () => ({ notify: mocks.notify }));
import { gitPresenter } from "./GitPresenter";
import { UnmergedBranchError } from "./gitErrors";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.invoke.mockResolvedValue({ stashed: false, restored: false });
});

it("switches the chosen child repository while retaining the complete workspace tree", async () => {
  await gitPresenter.switchBranch("/workspace/api", "feature");
  expect(mocks.invoke).toHaveBeenCalledWith("git_smart_checkout_branch", {
    rootDir: "/workspace/api", branchName: "feature",
  });
  expect(mocks.loadGitStatus).toHaveBeenCalledWith("/workspace/api");
  expect(mocks.invoke).toHaveBeenCalledWith("get_directory_structure", { rootDir: "/workspace" });
});

it("creates a branch without stashing or resetting the open workspace", async () => {
  await gitPresenter.createBranch("/workspace/api", "feature", true);

  expect(mocks.invoke).toHaveBeenCalledWith("git_create_branch", {
    rootDir: "/workspace/api", branchName: "feature", checkout: true,
  });
  expect(mocks.invoke).not.toHaveBeenCalledWith("git_smart_create_branch", expect.anything());
  expect(mocks.resetForBranchChange).not.toHaveBeenCalled();
  expect(mocks.loadGitStatus).toHaveBeenCalledWith("/workspace/api");
});

it("turns an unmerged-branch refusal into UnmergedBranchError without an error toast", async () => {
  mocks.invoke.mockRejectedValueOnce({ message: "error: the branch 'feature' is not fully merged." });

  await expect(gitPresenter.deleteBranch("/workspace", "feature", false)).rejects.toBeInstanceOf(UnmergedBranchError);
  expect(mocks.notify).not.toHaveBeenCalled();
});

it("still reports other delete failures", async () => {
  mocks.invoke.mockRejectedValueOnce({ message: "error: branch 'nope' not found." });

  await expect(gitPresenter.deleteBranch("/workspace", "nope", false)).rejects.not.toBeInstanceOf(UnmergedBranchError);
  expect(mocks.notify).toHaveBeenCalledWith("Deletion Failed", "error: branch 'nope' not found.", "error");
});
