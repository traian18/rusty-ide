import { explorerClient, type ExplorerClient } from "../client";
import type { ExternalPathInfo, SearchMatch, SearchOptions } from "../model";

export type { ExternalPathInfo, SearchMatch, SearchOptions };

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

export function createSearchService(client: ExplorerClient) {
  const search = (options: SearchOptions, isRegex: boolean) => client.searchProject({ ...options, isRegex });

  return {
    /**
     * Performs a search over filenames and line content in the target directory.
     * If a regex-enabled caller supplies ordinary code text that is not a valid regex, retry it as
     * a literal query. This keeps model-generated searches such as `describe(` useful while preserving
     * regex behavior for valid patterns.
     */
    async searchProject(options: SearchOptions): Promise<SearchMatch[]> {
      if (!options.rootDir || !options.query.trim()) {
        return [];
      }

      try {
        return await search(options, options.isRegex);
      } catch (error: unknown) {
        if (options.isRegex && errorMessage(error).includes("Invalid regex:")) {
          return search(options, false);
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
        return await client.checkExternalPath(path.trim());
      } catch {
        return null;
      }
    },
  };
}

export const searchService = createSearchService(explorerClient);
