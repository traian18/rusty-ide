import type { OpenTabRequest } from "../../tabs/types";
import type { GitRepository } from "../../store/types";
import { resolveRepositoryForPath } from "../git/resolveRepositoryForPath";

function isAbsolutePath(path: string): boolean {
  return path.startsWith("/") || path.startsWith("\\") || /^[A-Za-z]:[\\/]/.test(path);
}

function basename(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() || path;
}

export function resolveAgentFilePath(filePath: string, rootPath: string): string {
  if (isAbsolutePath(filePath)) return filePath;
  const relativePath = filePath.replace(/^[.][\\/]*/, "");
  return `${rootPath.replace(/[\\/]$/, "")}/${relativePath}`;
}

export function buildAgentChangedFileRequest(
  filePath: string,
  rootPath: string | undefined,
  repositories: GitRepository[] = [],
): OpenTabRequest | undefined {
  if (!rootPath) return undefined;

  const path = resolveAgentFilePath(filePath, rootPath);
  const repository = resolveRepositoryForPath(path, repositories);
  return {
    type: "git-diff",
    repoPath: repository?.worktreePath ?? rootPath,
    path,
    diffType: "unstaged",
    title: `${basename(path)} (Workspace)`,
  };
}

export function openAgentChangedFile(
  openTab: (request: OpenTabRequest) => unknown,
  filePath: string,
  rootPath: string | undefined,
  repositories: GitRepository[] = [],
): void {
  const request = buildAgentChangedFileRequest(filePath, rootPath, repositories);
  if (request) openTab(request);
}
