export interface FileActionParams {
  path: string;
  name: string;
  isDir: boolean;
}

/**
 * Filetree Actions Interface
 * 
 * Provides structural definitions for standard filesystem tasks.
 * Each method handles invoking Tauri backend operations and
 * triggers state reconciliations like directory refreshing.
 */
export interface FileTreeActions {
  createFile: (parentDir: string, name: string) => Promise<void>;
  createFolder: (parentDir: string, name: string) => Promise<void>;
  deleteItem: (
    item: FileActionParams,
    confirmFn: (options: { title: string; message: string; confirmLabel: string; cancelLabel: string; kind: "danger" | "warning" }) => Promise<boolean>
  ) => Promise<void>;
  deleteItems: (
    items: FileActionParams[],
    confirmFn: (options: { title: string; message: string; confirmLabel: string; cancelLabel: string; kind: "danger" | "warning" }) => Promise<boolean>
  ) => Promise<boolean>;
  moveItem: (srcPath: string, destPath: string) => Promise<void>;
  renameItem: (originalPath: string, newPath: string) => Promise<void>;
  openInFinder: (path: string) => Promise<void>;
}
