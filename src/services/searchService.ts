import { invoke } from "@tauri-apps/api/core";

export interface SearchMatch {
  path: string;
  name: string;
  line: number;
  content: string;
  is_content_match: boolean;
}

export interface SearchOptions {
  rootDir: string;
  query: string;
  matchCase: boolean;
  wholeWord: boolean;
  isRegex: boolean;
}

export interface ExternalPathInfo {
  path: string;
  name: string;
  exists: boolean;
  is_dir: boolean;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

function invokeSearch(options: SearchOptions, isRegex: boolean): Promise<SearchMatch[]> {
  return invoke<SearchMatch[]>("search_project", {
    rootDir: options.rootDir,
    query: options.query,
    matchCase: options.matchCase,
    wholeWord: options.wholeWord,
    isRegex,
  });
}

export const searchService = {
  /**
   * Performs a search over filenames and line content in the target directory using Tauri commands.
   * If a regex-enabled caller supplies ordinary code text that is not a valid regex, retry it as
   * a literal query. This keeps model-generated searches such as `describe(` useful while preserving
   * regex behavior for valid patterns.
   */
  async searchProject(options: SearchOptions): Promise<SearchMatch[]> {
    if (!options.rootDir || !options.query.trim()) {
      return [];
    }

    try {
      return await invokeSearch(options, options.isRegex);
    } catch (error: unknown) {
      if (options.isRegex && errorMessage(error).includes("Invalid regex:")) {
        return invokeSearch(options, false);
      }
      throw error;
    }
  },

  /**
   * Checks if a path (including external paths outside the workspace or paths with ~) exists on disk.
   */
  async checkExternalPath(path: string): Promise<ExternalPathInfo | null> {
    if (!path || !path.trim()) {
      return null;
    }
    try {
      return await invoke<ExternalPathInfo>("check_external_path", { path: path.trim() });
    } catch {
      return null;
    }
  },
};
