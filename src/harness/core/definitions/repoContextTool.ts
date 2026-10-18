// ============================================================
// definitions/repoContextTool.ts -- "repo_context": one read-only call that tells a model what a
// file or folder is connected to, what a change would reach, and how to start in a folder.
//
// The answer comes from rusty-core's repository intelligence (the same tool the engine exposes),
// run against this workspace by the `repository_context` command. It never changes a file, so it
// is available under every skill and workflow, in every mode. A language the analysis cannot read
// comes back as an answer with status `unsupported`, not as a failure.
// ============================================================

import { invoke } from "@tauri-apps/api/core";

import type { HostToolHandler } from "../CoreHarness";
import type { HostToolSpec } from "../SessionRecipe";

export const REPO_CONTEXT_TOOL: HostToolSpec = {
  name: "repo_context",
  description:
    "Use this FIRST, before search_codebase or read_file, whenever the question is how code connects: who imports or uses a file or folder, what moving, renaming, splitting, grouping, merging or deleting it would break, what a folder contains and how it is laid out, which tests cover a change, or where a feature starts. It answers from the repository's import and framework index in one call, so you do not have to open many files to find out. mode 'orient': a map of one folder (its sub-folders, loose files, entry points, most depended-on files); target '' is the whole repository; use it before reorganizing or grouping files. mode 'blast_radius': what may break if a file or folder changes, by depth, with the entry points and tests it reaches; use it before moving, renaming or deleting. mode 'connections' (default): what a file or folder imports, who imports it, framework links (routes, injections, components, commands), tests, findings and history. mode 'changes': for a list of changed files (targets), the packages, routes and tests they touch. Every answer has a status: ok, partial, unsupported (a language it cannot analyse: read the file instead), not_indexed, stale or not_found; plus a summary and ready-to-run next calls. It only reads; use search_codebase for text such as strings, configuration and documentation, which imports do not show. Documentation is kept per repository: a path inside a repository selects it; otherwise pass repository (the answer names the repository it came from).",
  input_schema: {
    type: "object",
    properties: {
      target: { type: "string", description: "A workspace-relative file or folder, a node id from an earlier answer (dir:<path>, rest:<folder>), or '' for the repository." },
      targets: { type: "array", items: { type: "string" }, description: "Changed files, only for mode 'changes'." },
      mode: { type: "string", enum: ["connections", "blast_radius", "orient", "changes"] },
      depth: { type: "integer", minimum: 1, maximum: 5, description: "How far a change is followed; default 2." },
      budget: { type: "integer", minimum: 1000, maximum: 20000, description: "Approximate size of the answer in characters; default 6000." },
      include: { type: "array", items: { type: "string", enum: ["frameworks", "findings", "history", "tests"] } },
      repository: { type: "string", description: "Which repository, by name or path, when the workspace holds several. Optional when the path names it." },
    },
    required: [],
  },
};

/** The line the system prompts show for the tool. */
export const REPO_CONTEXT_GUIDE =
  "- 'repo_context': Use it first to see how code connects, instead of searching or opening many files: who imports a file or folder, what moving, renaming, grouping or deleting it would break, a map of a folder (input: {\"target\": \"path\", \"mode\"?: \"connections\" | \"blast_radius\" | \"orient\" | \"changes\"}). Read-only; an unsupported language is reported, then read the file instead.";

/** Guideline for prompts that offer the tool. */
export const REPO_CONTEXT_GUIDELINE =
  "\n- Before you move, rename, split, group, merge or delete files, or change a public name, call 'repo_context' (mode 'orient' on the folder, 'blast_radius' on each file) to see what depends on them; to learn how code connects or what a folder holds, call it before reading many files or searching. If it says a language is unsupported or a file is stale or not indexed, read the file directly.";

function failureText(error: unknown): string {
  if (typeof error === "object" && error !== null && "message" in error) {
    const { code, message } = error as { code?: unknown; message?: unknown };
    return typeof code === "string" ? `${code}: ${String(message)}` : String(message);
  }
  return String(error);
}

/** `activeRepository` is the repository chosen in the IDE: the one a call is about when it names nothing else. */
export function repoContextTool(workspaceRoot: string, activeRepository?: string): HostToolHandler {
  return async (args) => {
    if (!workspaceRoot.trim()) return { ok: false, error: "No workspace is open, so there is no repository to analyse." };
    try {
      const output = (await invoke("repository_context", { root: workspaceRoot, activeRepository: activeRepository ?? null, arguments: args ?? {} })) as { result?: unknown };
      return { ok: true, output: JSON.stringify(output.result ?? output) };
    } catch (error: unknown) {
      return { ok: false, error: failureText(error) };
    }
  };
}
