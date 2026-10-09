import { describe, expect, it, vi } from "vitest";
import {
  buildAgentChangedFileRequest,
  openAgentChangedFile,
  resolveAgentFilePath,
} from "./AgentTabChangedFile";

describe("AgentTab changed file opener", () => {
  it("resolves relative paths and builds an unstaged workspace diff request", () => {
    expect(buildAgentChangedFileRequest("./src/file.ts", "/workspace/")).toEqual({
      type: "git-diff",
      repoPath: "/workspace/",
      path: "/workspace/src/file.ts",
      diffType: "unstaged",
    });
  });

  it("uses the most specific discovered repository for nested files", () => {
    const request = buildAgentChangedFileRequest("rusty-ide/src/file.ts", "/workspace", [
      { worktreePath: "/workspace", id: "root" },
      { worktreePath: "/workspace/rusty-ide", id: "nested" },
    ] as any);

    expect(request?.repoPath).toBe("/workspace/rusty-ide");
  });

  it("does not open a malformed request without a repository root", () => {
    const openTab = vi.fn();
    expect(buildAgentChangedFileRequest("src/file.ts", undefined)).toBeUndefined();
    openAgentChangedFile(openTab, "src/file.ts", undefined);
    expect(openTab).not.toHaveBeenCalled();
  });

  it("passes the complete fallback request to openTab", () => {
    const openTab = vi.fn();
    openAgentChangedFile(openTab, "src/file.ts", "/workspace");
    expect(openTab).toHaveBeenCalledWith({
      type: "git-diff", repoPath: "/workspace", path: "/workspace/src/file.ts",
      diffType: "unstaged",
    });
  });
});
