import { describe, expect, it } from "vitest";
import type { GitRepository, GitStatusResult } from "../../store/types";
import { repositoryIndicator } from "./repositoryIndicator";

const repository = (worktreePath: string, head: GitRepository["head"] = { mode: "branch", branch: "main", oid: "abc1234def" }): GitRepository => ({
  id: worktreePath,
  worktreePath,
  gitDir: `${worktreePath}/.git`,
  kind: "workspace",
  parentId: null,
  submodulePath: null,
  initialized: true,
  head,
  submoduleState: null,
});

const status = (overrides: Partial<GitStatusResult> = {}): GitStatusResult => ({
  isRepo: true,
  currentBranch: "main",
  staged: [],
  unstaged: [],
  conflicted: [],
  pendingOperation: null,
  ...overrides,
});

describe("repositoryIndicator", () => {
  it("shows nothing with no project open", () => {
    expect(repositoryIndicator([], null, "", null)).toBeNull();
  });

  it("names a single repository after the project", () => {
    const repo = repository("/work/rusty-ide");

    expect(repositoryIndicator([repo], repo.id, "/work/rusty-ide", status())).toMatchObject({
      project: "rusty-ide",
      branch: "main",
      path: "/work/rusty-ide",
    });
  });

  it("names the repository selected in a multi-repo workspace, not the workspace", () => {
    const repos = [repository("/work/rusty-core", { mode: "branch", branch: "release", oid: null }), repository("/work/rusty-ide")];

    expect(repositoryIndicator(repos, repos[0].id, "/work", status())).toMatchObject({ project: "rusty-core", branch: "release" });
    expect(repositoryIndicator(repos, repos[1].id, "/work", status())).toMatchObject({ project: "rusty-ide", branch: "main" });
  });

  it("keeps two nested repositories with the same folder name apart", () => {
    const repos = [repository("/work/api/app"), repository("/work/web/app")];

    expect(repositoryIndicator(repos, repos[1].id, "/work", status())?.project).toBe("web/app");
  });

  it("uses the folder name when the workspace root is the selected repository", () => {
    const repos = [repository("/work/mono"), repository("/work/mono/vendor/lib")];

    expect(repositoryIndicator(repos, repos[0].id, "/work/mono", status())?.project).toBe("mono");
  });

  it("says when HEAD is not on a branch", () => {
    const repo = repository("/work/app", { mode: "detached", branch: null, oid: "abc1234def" });

    expect(repositoryIndicator([repo], repo.id, "/work/app", status())?.branch).toBe("detached @ abc1234");
  });

  it("falls back to the status before repositories are discovered, and has no branch outside a repository", () => {
    expect(repositoryIndicator([], null, "/work/app", status({ currentBranch: "dev" }))).toMatchObject({ project: "app", branch: "dev" });
    expect(repositoryIndicator([], null, "/work/notes/", status({ isRepo: false, currentBranch: "" }))).toMatchObject({ project: "notes", branch: "" });
  });

  it("carries an unfinished merge and its conflicts", () => {
    const repo = repository("/work/app");
    const conflicted = [{ path: "/work/app/a.ts", name: "a.ts", status_type: "conflicted" as const }];

    expect(repositoryIndicator([repo], repo.id, "/work/app", status({ pendingOperation: "merge", conflicted }))).toMatchObject({
      pendingOperation: "merge",
      conflicts: 1,
    });
  });
});
