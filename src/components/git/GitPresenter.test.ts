import { expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  invoke: vi.fn().mockResolvedValue({ stashed: false, restored: false }),
  resetForBranchChange: vi.fn(), loadGitStatus: vi.fn(), setFileTree: vi.fn(),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("../../store", () => ({ useWorkspaceStore: { getState: () => ({
  rootPath: "/workspace", resetForBranchChange: mocks.resetForBranchChange,
  loadGitStatus: mocks.loadGitStatus, setFileTree: mocks.setFileTree,
}) } }));
vi.mock("../../notificationStore", () => ({ notify: vi.fn() }));
import { gitPresenter } from "./GitPresenter";

it("switches the chosen child repository while retaining the complete workspace tree", async () => {
  await gitPresenter.switchBranch("/workspace/api", "feature");
  expect(mocks.invoke).toHaveBeenCalledWith("git_smart_checkout_branch", {
    rootDir: "/workspace/api", branchName: "feature",
  });
  expect(mocks.loadGitStatus).toHaveBeenCalledWith("/workspace/api");
  expect(mocks.invoke).toHaveBeenCalledWith("get_directory_structure", { rootDir: "/workspace" });
});
