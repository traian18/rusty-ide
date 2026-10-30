/** Every command the explorer calls: the file tree, file operations and project search. */
import { invoke } from "@tauri-apps/api/core";
import type { ExternalPathInfo, FileEntry, SearchMatch, SearchOptions } from "./model";

/** Calls a Tauri command by name. The app passes the real bridge; tests pass a fake one. */
export type Invoke = <T>(command: string, args: Record<string, unknown>) => Promise<T>;

export interface ExplorerClient {
  /** The workspace's file tree, rooted at `root`. */
  tree(root: string): Promise<FileEntry[]>;
  createFile(path: string): Promise<void>;
  createDirectory(path: string): Promise<void>;
  deleteItem(path: string): Promise<void>;
  /** Moves or renames a file or folder. */
  move(src: string, dest: string): Promise<void>;
  searchProject(options: SearchOptions): Promise<SearchMatch[]>;
  /** Whether a path outside the workspace (or one with `~`) exists on disk. */
  checkExternalPath(path: string): Promise<ExternalPathInfo>;
}

/** Builds the explorer client on a command bridge. Each method names one Tauri command and its arguments. */
export function createExplorerClient(call: Invoke): ExplorerClient {
  return {
    tree: (root) => call<FileEntry[]>("get_directory_structure", { rootDir: root }),
    createFile: (path) => call<void>("create_file", { path }),
    createDirectory: (path) => call<void>("create_directory", { path }),
    deleteItem: (path) => call<void>("delete_file_or_dir", { path }),
    move: (src, dest) => call<void>("move_file_or_dir", { src, dest }),
    searchProject: (options) => call<SearchMatch[]>("search_project", { options }),
    checkExternalPath: (path) => call<ExternalPathInfo>("check_external_path", { path }),
  };
}

export const explorerClient = createExplorerClient(invoke);
