import { invoke } from "@tauri-apps/api/core";
import type { DiffKind } from "../../tabs/types";

type Invoke = <T>(command: string, args: Record<string, string>) => Promise<T>;

export interface GitDiffContent {
  original: string;
  modified: string;
}

export async function loadGitDiffContent(
  tab: {
    repoPath: string;
    path: string;
    diffType?: DiffKind;
    commitHash?: string;
  },
  invokeCommand: Invoke = invoke,
): Promise<GitDiffContent> {
  if (tab.diffType === "commit") {
    const commitHash = tab.commitHash;
    if (!commitHash?.trim()) {
      throw new Error("commitHash is required for commit diffs");
    }

    return {
      original: await invokeCommand<string>("git_get_file_content_at_rev", {
        rootDir: tab.repoPath,
        revision: `${commitHash}~1`,
        filePath: tab.path,
      }),
      modified: await invokeCommand<string>("git_get_file_content_at_rev", {
        rootDir: tab.repoPath,
        revision: commitHash,
        filePath: tab.path,
      }),
    };
  }

  if (tab.diffType === "staged") {
    return {
      original: await invokeCommand<string>("git_get_head_content", {
        rootDir: tab.repoPath,
        filePath: tab.path,
      }),
      modified: await invokeCommand<string>("git_get_index_content", {
        rootDir: tab.repoPath,
        filePath: tab.path,
      }),
    };
  }

  return {
    original: await invokeCommand<string>("git_get_index_content", {
      rootDir: tab.repoPath,
      filePath: tab.path,
    }),
    modified: await invokeCommand<string>("read_file_disk", { path: tab.path }),
  };
}
