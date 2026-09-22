import { create } from "zustand";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createGitSlice } from "./createGitSlice";
import type { WorkspaceState } from "../types";
const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
const rawRepo = (path: string, branch = "main") => ({
  id: path, worktree_path: path, git_dir: `${path}/.git`, kind: "nested", initialized: true,
  head: { mode: "branch", branch, oid: "abc" },
});
const status = (branch: string) => ({ is_repo: true, current_branch: branch, staged: [], unstaged: [] });
const makeStore = () => create<WorkspaceState>()((...args) => ({
  ...createGitSlice(...args), rootPath: "/workspace",
}) as WorkspaceState);
beforeEach(() => invoke.mockReset());

describe("workspace repositories", () => {
  it("discovers children and preserves the selected repository on refresh", async () => {
    invoke.mockResolvedValue([rawRepo("/workspace/api"), rawRepo("/workspace/infra", "deploy")]);
    const store = makeStore();
    await store.getState().discoverRepositories();
    expect(invoke).toHaveBeenCalledWith("git_discover_workspace_repositories", { rootDir: "/workspace" });
    expect(store.getState().activeRepositoryId).toBe("/workspace/api");
    store.getState().setActiveRepositoryId("/workspace/infra");
    await store.getState().discoverRepositories();
    expect(store.getState().activeRepositoryId).toBe("/workspace/infra");
    expect(store.getState().repositoriesLoading).toBe(false);
  });

  it("ignores an old workspace discovery arriving after a newer one", async () => {
    let resolveOld!: (value: unknown) => void;
    invoke.mockImplementationOnce(() => new Promise((resolve) => { resolveOld = resolve; }));
    const store = makeStore();
    const old = store.getState().discoverRepositories();
    store.setState({ rootPath: "/new" });
    invoke.mockResolvedValue([rawRepo("/new/service")]);
    await store.getState().discoverRepositories();
    resolveOld([rawRepo("/workspace/api")]);
    await old;
    expect(store.getState().repositories.map((repo) => repo.id)).toEqual(["/new/service"]);
  });

  it("refreshes the selected checkout HEAD and keeps status separate from the workspace", async () => {
    invoke.mockResolvedValueOnce([rawRepo("/workspace/api"), rawRepo("/workspace/infra")]);
    const store = makeStore();
    await store.getState().discoverRepositories();
    invoke.mockImplementation(async (command: string) => command === "git_status"
      ? status("feature") : rawRepo("/workspace/api", "feature"));
    await store.getState().loadGitStatus("/workspace/api");
    expect(store.getState().statusByRepositoryId["/workspace/api"].currentBranch).toBe("feature");
    expect(store.getState().repositories[0].head.branch).toBe("feature");
    expect(store.getState().statusByRepositoryId["/workspace/infra"]).toBeUndefined();
    expect(store.getState().gitStatus).toBeNull();
  });

  it("runs submodule actions in their owning repository, not the non-Git workspace", async () => {
    const parent = rawRepo("/workspace/api");
    const sub = { ...rawRepo("/workspace/api/vendor/lib"), kind: "submodule", parent_id: parent.id, submodule_path: "vendor/lib" };
    invoke.mockResolvedValueOnce([parent, sub]);
    const store = makeStore();
    await store.getState().discoverRepositories();
    invoke.mockImplementation(async (command: string) => {
      if (command === "git_discover_workspace_repositories") return [parent, sub];
      if (command === "git_discover_repository") return parent;
      return status("main");
    });
    await store.getState().updateSubmodule(sub.id, true);
    expect(invoke).toHaveBeenCalledWith("git_submodule_update", {
      rootDir: parent.id, submodulePath: "vendor/lib", recursive: true,
    });
  });
  it("ignores a slower previous status/HEAD request for the same checkout", async () => {
    invoke.mockResolvedValueOnce([rawRepo("/workspace/api")]);
    const store = makeStore();
    await store.getState().discoverRepositories();
    let resolveStatus!: (value: unknown) => void;
    let resolveHead!: (value: unknown) => void;
    invoke.mockImplementationOnce(() => new Promise((resolve) => { resolveStatus = resolve; }))
      .mockImplementationOnce(() => new Promise((resolve) => { resolveHead = resolve; }));
    const old = store.getState().loadRepositoryGitStatus("/workspace/api");
    invoke.mockResolvedValueOnce(status("feature")).mockResolvedValueOnce(rawRepo("/workspace/api", "feature"));
    await store.getState().loadRepositoryGitStatus("/workspace/api");
    resolveStatus(status("main"));
    resolveHead(rawRepo("/workspace/api", "main"));
    await old;
    expect(store.getState().repositories[0].head.branch).toBe("feature");
    expect(store.getState().statusByRepositoryId["/workspace/api"].currentBranch).toBe("feature");
  });

});
