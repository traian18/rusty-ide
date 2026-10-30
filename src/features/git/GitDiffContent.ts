import type { DiffKind } from "../../app/tabs/types";
import { gitClient, type GitClient } from "./client";

/** The reads a diff needs: git content for either side, and the working file for the modified side. */
export type GitContentSource = Pick<GitClient, "fileContentAtRevision" | "headContent" | "indexContent" | "readWorkingFile">;

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
  git: GitContentSource = gitClient,
): Promise<GitDiffContent> {
  if (tab.diffType === "commit") {
    const commitHash = tab.commitHash;
    if (!commitHash?.trim()) {
      throw new Error("commitHash is required for commit diffs");
    }

    return {
      original: await git.fileContentAtRevision(tab.repoPath, tab.path, `${commitHash}~1`),
      modified: await git.fileContentAtRevision(tab.repoPath, tab.path, commitHash),
    };
  }

  if (tab.diffType === "revision") {
    const revision = tab.commitHash;
    if (!revision?.trim()) {
      throw new Error("commitHash is required for revision diffs");
    }

    return {
      original: await git.fileContentAtRevision(tab.repoPath, tab.path, revision),
      modified: await git.readWorkingFile(tab.path),
    };
  }

  if (tab.diffType === "staged") {
    return {
      original: await git.headContent(tab.repoPath, tab.path),
      modified: await git.indexContent(tab.repoPath, tab.path),
    };
  }

  return {
    original: await git.indexContent(tab.repoPath, tab.path),
    modified: await git.readWorkingFile(tab.path),
  };
}
