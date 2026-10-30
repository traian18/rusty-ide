import { describe, expect, it } from "vitest";
import { buildGitDiffRequest } from "./gitDiffRequest";
import type { OpenTabRequest } from "./types";

const validInput = {
  repoPath: "/repo",
  path: "/repo/src/file.ts",
  diffType: "staged" as const,
};

describe("buildGitDiffRequest", () => {
  it.each(["staged", "unstaged"] as const)("builds a valid %s request", (diffType) => {
    expect(buildGitDiffRequest({ ...validInput, diffType })).toEqual({
      type: "git-diff",
      repoPath: "/repo",
      path: "/repo/src/file.ts",
      diffType,
    });
  });

  it("builds a valid commit request", () => {
    const request: OpenTabRequest = buildGitDiffRequest({
      ...validInput,
      diffType: "commit",
      commitHash: "abc123",
    });
    expect(request).toEqual({
      type: "git-diff",
      repoPath: "/repo",
      path: "/repo/src/file.ts",
      diffType: "commit",
      commitHash: "abc123",
    });
    expect(request).not.toHaveProperty("title");
  });

  it.each([
    ["repoPath", { repoPath: "" }],
    ["repoPath", { repoPath: "   " }],
    ["path", { path: "" }],
    ["path", { path: "\t\n" }],
  ])("rejects an empty %s", (field, override) => {
    expect(() => buildGitDiffRequest({ ...validInput, ...override })).toThrow(
      `${field} is required`,
    );
  });

  it.each([undefined, "", "   "])("rejects a commit without a non-empty hash", (commitHash) => {
    expect(() => buildGitDiffRequest({ ...validInput, diffType: "commit", commitHash })).toThrow(
      "commitHash is required for commit diffs",
    );
  });

  it.each([
    ["staged", "abc123"],
    ["unstaged", "abc123"],
  ] as const)(
    "rejects a non-empty commit hash for %s diffs",
    (diffType, commitHash) => {
      expect(() => buildGitDiffRequest({ ...validInput, diffType, commitHash })).toThrow(
        "commitHash is only valid for commit diffs",
      );
    },
  );

  it.each(["", "   "])("rejects a supplied hash for staged or unstaged diffs", (commitHash) => {
    expect(() => buildGitDiffRequest({ ...validInput, commitHash })).toThrow(
      "commitHash is only valid for commit diffs",
    );
    expect(() => buildGitDiffRequest({ ...validInput, diffType: "unstaged", commitHash })).toThrow(
      "commitHash is only valid for commit diffs",
    );
  });

  it("preserves valid input strings exactly", () => {
    expect(buildGitDiffRequest({
      repoPath: " /repo ",
      path: " /repo/file.ts ",
      diffType: "commit",
      commitHash: " abc123 ",
    })).toMatchObject({ repoPath: " /repo ", path: " /repo/file.ts ", commitHash: " abc123 " });
  });
});
