export type SelectFileInTree = (filePath: string) => void;

/** Requests Explorer selection only for a supported blame enable transition. */
export function requestFileTreeSelectionOnBlameEnable(
  showBlame: boolean,
  filePath: string,
  vfsTabId: string | undefined,
  isImage: boolean,
  selectFileInTree: SelectFileInTree,
): boolean {
  if (showBlame || vfsTabId || isImage) return false;
  selectFileInTree(filePath);
  return true;
}
