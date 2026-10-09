import type { OpenTabRequest } from "../../tabs/types";
import type { GitRepository } from "../../store/types";
import { buildGitDiffRequest } from "../../tabs/gitDiffRequest";
import { resolveRepositoryForPath } from "../git/resolveRepositoryForPath";

function isAbsolutePath(path: string): boolean {
  return path.startsWith("/") || path.startsWith("\\") || /^[A-Za-z]:[\\/]/.test(path);
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
  return buildGitDiffRequest({
    repoPath: repository?.worktreePath ?? rootPath,
    path,
    diffType: "unstaged",
  });
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
