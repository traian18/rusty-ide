import { describe, expect, it, vi } from "vitest";
import { loadGitDiffContent } from "./GitDiffContent";
import { createGitClient, type Invoke } from "./client";
import { buildAgentChangedFileRequest } from "../agent-chat";

type Call = [string, Record<string, unknown>];

function mockedInvoke(values: Record<string, unknown>) {
  const calls: Call[] = [];
  const invokeCommand = vi.fn(async (command: string, args: Record<string, unknown>) => {
    calls.push([command, args]);
    return values[command] ?? "";
  });
  // The mock is not generic, so the client takes it through this typed view of the same function.
  const bridge = invokeCommand as unknown as Invoke;
  return { calls, invokeCommand, bridge };
}

describe("loadGitDiffContent", () => {
  const tab = { repoPath: "/repo", path: "/repo/src/file.ts" };

  it("loads a revision diff as the file at that ref versus the working tree", async () => {
    const { calls, bridge } = mockedInvoke({
      git_get_file_content_at_rev: "at ref",
      read_file_disk: "working tree version",
    });

    await expect(
      loadGitDiffContent({ ...tab, diffType: "revision", commitHash: "origin/main" }, createGitClient(bridge)),
    ).resolves.toEqual({ original: "at ref", modified: "working tree version" });
    expect(calls).toEqual([
      ["git_get_file_content_at_rev", { rootDir: "/repo", revision: "origin/main", filePath: "/repo/src/file.ts" }],
      ["read_file_disk", { path: "/repo/src/file.ts" }],
    ]);
  });

  it("loads tracked unstaged content from the index and working tree disk", async () => {
    const { calls, bridge } = mockedInvoke({
      git_get_index_content: "indexed version",
      read_file_disk: "working tree version",
    });

    await expect(loadGitDiffContent(tab, createGitClient(bridge))).resolves.toEqual({
      original: "indexed version",
      modified: "working tree version",
    });
    expect(calls).toEqual([
      ["git_get_index_content", { rootDir: "/repo", filePath: "/repo/src/file.ts" }],
      ["read_file_disk", { path: "/repo/src/file.ts" }],
    ]);
  });

  it("loads nested Agent requests with the same index-versus-disk content as the sidebar", async () => {
    const request = buildAgentChangedFileRequest("rusty-ide/src/file.ts", "/workspace", [
      { id: "nested", worktreePath: "/workspace/rusty-ide" },
    ] as never)!;
    const values = { git_get_index_content: "const value = 1;", read_file_disk: "const value = 2;" };
    const agent = mockedInvoke(values);
    const sidebar = mockedInvoke(values);
    const content = await loadGitDiffContent(request, createGitClient(agent.bridge));
    expect(content).toEqual({ original: values.git_get_index_content, modified: values.read_file_disk });
    expect(agent.calls).toEqual([
      ["git_get_index_content", { rootDir: "/workspace/rusty-ide", filePath: "/workspace/rusty-ide/src/file.ts" }],
      ["read_file_disk", { path: "/workspace/rusty-ide/src/file.ts" }],
    ]);
    expect(await loadGitDiffContent({
      repoPath: "/workspace/rusty-ide", path: "/workspace/rusty-ide/src/file.ts", diffType: "unstaged",
    }, createGitClient(sidebar.bridge))).toEqual(content);
    expect(sidebar.calls).toEqual(agent.calls);
  });

  it("preserves an empty index result for an untracked file and reads its disk content", async () => {
    const { calls, bridge } = mockedInvoke({
      git_get_index_content: "",
      read_file_disk: "new working tree file",
    });

    await expect(loadGitDiffContent(tab, createGitClient(bridge))).resolves.toEqual({
      original: "",
      modified: "new working tree file",
    });
    expect(calls.map(([command]) => command)).toEqual([
      "git_get_index_content",
      "read_file_disk",
    ]);
  });

  it("keeps disk read failures distinguishable from valid empty content", async () => {
    const { invokeCommand, bridge } = mockedInvoke({ git_get_index_content: "indexed" });
    invokeCommand.mockImplementationOnce(async () => "indexed");
    invokeCommand.mockImplementationOnce(async () => {
      throw new Error("working tree file is unreadable");
    });

    await expect(loadGitDiffContent(tab, createGitClient(bridge))).rejects.toThrow(
      "working tree file is unreadable",
    );
  });

  it("keeps staged diffs on HEAD versus index", async () => {
    const { calls, bridge } = mockedInvoke({
      git_get_head_content: "HEAD version",
      git_get_index_content: "staged version",
      read_file_disk: "must not be read",
    });

    await expect(
      loadGitDiffContent({ ...tab, diffType: "staged" }, createGitClient(bridge)),
    ).resolves.toEqual({ original: "HEAD version", modified: "staged version" });
    expect(calls.map(([command]) => command)).toEqual([
      "git_get_head_content",
      "git_get_index_content",
    ]);
  });

  it.each([undefined, "   "])("rejects an incomplete commit request before invoking commands", async (commitHash) => {
    const { calls, bridge } = mockedInvoke({});

    await expect(loadGitDiffContent(
      { ...tab, diffType: "commit", commitHash },
      createGitClient(bridge),
    )).rejects.toThrow(/commitHash.*required/i);
    expect(calls).toHaveLength(0);
  });

  it("keeps commit diffs on the parent and selected revisions", async () => {
    const { calls, bridge } = mockedInvoke({
      git_get_file_content_at_rev: "revision content",
    });

    await loadGitDiffContent(
      { ...tab, diffType: "commit", commitHash: "abc123" },
      createGitClient(bridge),
    );
    expect(calls).toEqual([
      ["git_get_file_content_at_rev", {
        rootDir: "/repo",
        revision: "abc123~1",
        filePath: "/repo/src/file.ts",
      }],
      ["git_get_file_content_at_rev", {
        rootDir: "/repo",
        revision: "abc123",
        filePath: "/repo/src/file.ts",
      }],
    ]);
  });
});
