// ============================================================
// definitions/repoWikiTool.ts -- "repo_wiki": the repository's documentation pages, read-only.
//
// A page says what a file, folder, package or the whole repository is, what it contains and what
// it connects to, each fact with the file and line range it comes from. Pages are rendered by
// rusty-core from the repository index (the `repository_wiki_tool` command), so they follow the
// code and say when a file changed since the index was built. It never changes a file, so it is
// available under every skill and workflow, like repo_context.
// ============================================================

import { invoke } from "@tauri-apps/api/core";

import type { HostToolHandler } from "../CoreHarness";
import type { HostToolSpec } from "../SessionRecipe";

export const REPO_WIKI_TOOL: HostToolSpec = {
  name: "repo_wiki",
  description:
    "Read the repository's documentation pages: what a file, folder, package or the whole repository is, what it contains, what it imports and who imports it, framework links, tests, findings and history, each fact with the file and line range it comes from. Use it to learn a part of the code before changing it, and to find the pages one level below with action 'children'. target is a page id (file:src/a.rs, folder:dir:src, package:<id>, repo:), a workspace path, or '' for the repository. If a page says stale, the file changed after the index was built: read the file. For who-breaks-if-this-changes questions use repo_context instead. Documentation is kept per repository: a path inside a repository selects it; otherwise pass repository (the answer names the repository it came from). Read-only.",
  input_schema: {
    type: "object",
    properties: {
      action: { type: "string", enum: ["page", "children"], description: "page (default) or children (the pages one level below)." },
      target: { type: "string", description: "A page id, a workspace path, or '' for the repository." },
      format: { type: "string", enum: ["markdown", "json"], description: "markdown (default) or json." },
      repository: { type: "string", description: "Which repository, by name or path, when the workspace holds several. Optional when the path names it." },
    },
    required: [],
  },
};

/** The line the system prompts show for the tool. */
export const REPO_WIKI_GUIDE =
  "- 'repo_wiki': Read the documentation page for a file, folder, package or the repository, with line-range citations, instead of opening many files (input: {\"target\": \"path or page id\", \"action\"?: \"page\" | \"children\"}). Read-only.";

function failureText(error: unknown): string {
  if (typeof error === "object" && error !== null && "message" in error) {
    const { code, message } = error as { code?: unknown; message?: unknown };
    return typeof code === "string" ? `${code}: ${String(message)}` : String(message);
  }
  return String(error);
}

/** `activeRepository` is the repository chosen in the IDE: the one a call is about when it names nothing else. */
export function repoWikiTool(workspaceRoot: string, activeRepository?: string): HostToolHandler {
  return async (args) => {
    if (!workspaceRoot.trim()) return { ok: false, error: "No workspace is open, so there is no repository to document." };
    try {
      const output = (await invoke("repository_wiki_tool", { root: workspaceRoot, activeRepository: activeRepository ?? null, arguments: args ?? {} })) as { result?: unknown };
      return { ok: true, output: JSON.stringify(output.result ?? output) };
    } catch (error: unknown) {
      return { ok: false, error: failureText(error) };
    }
  };
}
