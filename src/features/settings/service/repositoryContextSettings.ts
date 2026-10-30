/**
 * Two switches for repository documentation, both on by default and kept in this browser profile:
 * indexing the workspace in the background (no model, no spend), and adding documentation pages to
 * a chat's context. Reads and writes never throw: storage can be unavailable.
 */
const INDEXING_KEY = "rusty.repositoryIndexing";
const CONTEXT_KEY = "rusty.repositoryContext";

function read(key: string): boolean {
  try {
    return globalThis.localStorage?.getItem(key) !== "off";
  } catch {
    return true;
  }
}

function write(key: string, enabled: boolean): void {
  try {
    globalThis.localStorage?.setItem(key, enabled ? "on" : "off");
  } catch {
    // Nothing to persist to; the switch simply is not remembered.
  }
}

export const repositoryIndexingEnabled = () => read(INDEXING_KEY);
export const setRepositoryIndexingEnabled = (enabled: boolean) => write(INDEXING_KEY, enabled);
export const repositoryContextEnabled = () => read(CONTEXT_KEY);
export const setRepositoryContextEnabled = (enabled: boolean) => write(CONTEXT_KEY, enabled);
