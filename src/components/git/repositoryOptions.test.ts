import { describe, expect, it } from "vitest";
import type { GitRepository } from "../../store/types";
import { repositoryOptions } from "./repositoryOptions";

const repo = (worktreePath: string, kind: GitRepository["kind"] = "workspace"): GitRepository => ({
  id: worktreePath, worktreePath, gitDir: `${worktreePath}/.git`, kind, parentId: null, submodulePath: null, initialized: true,
  head: { mode: "unborn" } as unknown as GitRepository["head"], submoduleState: null,
});

describe("repositoryOptions", () => {
  it("names the root as the workspace and others relative to it", () => {
    expect(repositoryOptions([repo("/ws"), repo("/ws/api"), repo("/ws/tools/cli")], "/ws/")).toEqual([
      { id: "/ws", name: "ws (workspace)" },
      { id: "/ws/api", name: "api" },
      { id: "/ws/tools/cli", name: "tools/cli" },
    ]);
  });

  it("marks worktrees and submodules, and keeps paths outside the root whole", () => {
    expect(repositoryOptions([repo("/ws/lib", "submodule"), repo("/elsewhere/wt", "worktree")], "/ws")).toEqual([
      { id: "/ws/lib", name: "lib (submodule)" },
      { id: "/elsewhere/wt", name: "/elsewhere/wt (worktree)" },
    ]);
  });

  it("accepts Windows separators", () => {
    expect(repositoryOptions([repo("C:\\ws\\api")], "C:\\ws")).toEqual([{ id: "C:\\ws\\api", name: "api" }]);
  });
});
