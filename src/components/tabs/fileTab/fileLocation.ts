import { useMemo } from "react";
import { useWorkspaceStore } from "../../../store";
import { getFileTypeDetails } from "../../../services/fileTypeService";
import { isImageFile } from "../../../services/imageFile";
import { resolveRepositoryForPath } from "../../git/resolveRepositoryForPath";
import type { TabOfType } from "../../../tabs/types";

export type FileTabData = TabOfType<"file">;

/** Where a file tab's file lives and what kind of file it is. */
export interface FileLocation {
  rootPath: string;
  /** The repository that owns the file, else the workspace root. */
  repoPath: string;
  isMarkdown: boolean;
  isImage: boolean;
  /** The canvas whose virtual file system holds the file, if any. */
  canvasTabId?: string;
  monacoModelUri: string;
  /** Blame and the change gutter apply: a file on disk inside a repository, not an image. */
  tracksGit: boolean;
}

/** The canvas whose VFS holds the file: the tab's own, else one whose nodes modified it. */
function canvasTabFor(path: string, vfsTabId: string | undefined): string | undefined {
  if (vfsTabId) return vfsTabId;
  const contexts = useWorkspaceStore.getState().canvasContexts;
  for (const tId in contexts) {
    if (contexts[tId].nodes.some((n: any) => n.data?.modifiedFiles?.includes(path))) return tId;
  }
  return undefined;
}

function modelUriFor(path: string, vfsTabId: string | undefined): string {
  return vfsTabId ? `vfs://${vfsTabId}/${path.replace(/^\//, "")}` : `file://${path}`;
}

function tracksGit(tab: FileTabData, repoPath: string, isImage: boolean): boolean {
  const onDisk = Boolean(tab.path) && !tab.vfsTabId;
  return Boolean(repoPath) && onDisk && !isImage;
}

export function useFileLocation(tab: FileTabData): FileLocation {
  const rootPath = useWorkspaceStore((state) => state.rootPath);
  const repositories = useWorkspaceStore((state) => state.repositories);
  const canvasTabId = useMemo(() => canvasTabFor(tab.path, tab.vfsTabId), [tab.path, tab.vfsTabId]);

  // The repository that actually owns this file (REFACTOR_PLAN.md PR 5b
  // commit 19) -- falls back to the workspace root, the pre-PR-5 behavior,
  // when repositories hasn't been discovered yet or the file isn't inside
  // any discovered submodule/worktree. Computed per-render rather than
  // stored on the tab itself: repositories is already global store state,
  // so there's nothing to gain from threading a repoPath field through
  // every place a file tab gets created.
  const repoPath = resolveRepositoryForPath(tab.path, repositories)?.worktreePath ?? rootPath;
  const isImage = isImageFile(tab.path);

  return {
    rootPath,
    repoPath,
    isMarkdown: getFileTypeDetails(tab.path).language === "markdown",
    isImage,
    canvasTabId,
    monacoModelUri: modelUriFor(tab.path, tab.vfsTabId),
    tracksGit: tracksGit(tab, repoPath, isImage),
  };
}
