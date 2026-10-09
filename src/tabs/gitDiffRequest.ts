import type { DiffKind, OpenTabRequest } from "./types";

export type GitDiffRequestInput = {
  repoPath: string;
  path: string;
  diffType: DiffKind;
  commitHash?: string;
};

export type GitDiffRequest = Extract<OpenTabRequest, { type: "git-diff" }>;

export function buildGitDiffRequest({
  repoPath,
  path,
  diffType,
  commitHash,
}: GitDiffRequestInput): GitDiffRequest {
  if (!repoPath.trim()) throw new Error("repoPath is required");
  if (!path.trim()) throw new Error("path is required");

  if (diffType === "commit") {
    if (!commitHash?.trim()) throw new Error("commitHash is required for commit diffs");
  } else if (commitHash !== undefined) {
    throw new Error("commitHash is only valid for commit diffs");
  }

  return {
    type: "git-diff",
    repoPath,
    path,
    diffType,
    ...(commitHash === undefined ? {} : { commitHash }),
  };
}
