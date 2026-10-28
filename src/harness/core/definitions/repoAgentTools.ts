// ============================================================
// definitions/repoAgentTools.ts -- the question-shaped repository tools of the plain agent loop:
// repo_overview, repo_health, repo_risk and repo_symbol. Each is read-only and answered by the
// host (`repository_agent_tool`) from the repository's index, Git history and code health, with
// the same envelope as repo_context: status, summary, sections, and when they say something
// stale / complete / truncated / ignored, plus ready-to-run next calls.
// ============================================================

import { invoke } from "@tauri-apps/api/core";

import type { HostToolHandler } from "../CoreHarness";
import type { HostToolSpec } from "../SessionRecipe";
import { CODE_GUIDELINES_GUIDE, CODE_GUIDELINES_TOOL } from "./guidelinesTool";

const REPOSITORY = { type: "string", description: "Which repository, by name or path, when the workspace holds several. Optional when a path names it." };
const BUDGET = { type: "integer", minimum: 1000, maximum: 24000, description: "Approximate answer size in characters." };

export const REPO_OVERVIEW_TOOL: HostToolSpec = {
  name: "repo_overview",
  description:
    "The shape of an unfamiliar repository in one call: the written overview (when documentation exists), the packages and the heaviest dependencies between them, entry points and the most depended-on files, code health, recent history (hotspots, active contributors) and where to start reading. Call it once, first, in a repository you do not know; it does not change during a conversation, so do not call it again. include 'outline' lists the documentation pages, 'glossary' and 'landscape' add those pages.",
  input_schema: {
    type: "object",
    properties: {
      include: { type: "array", items: { type: "string", enum: ["outline", "glossary", "landscape"] } },
      budget: BUDGET,
      repository: REPOSITORY,
    },
    required: [],
  },
};

export const REPO_HEALTH_TOOL: HostToolSpec = {
  name: "repo_health",
  description:
    "Code health (1-10, from measured complexity, structure and change history; no linter, no model). No arguments: the repository score and a fix-first list (findings ranked by what they cost, more for files that change often and that many import), the worst files and the most common issues. targets: those files measured from the disk NOW next to the indexed score, with their findings by line; call it after editing a file to see whether it got better or worse. finding: one finding id with exact instructions to fix it (location, measured values, what the check looks for, how to fix, when it is done).",
  input_schema: {
    type: "object",
    properties: {
      targets: { type: "array", items: { type: "string" }, description: "Workspace-relative files." },
      finding: { type: "string", description: "A finding id from an earlier answer." },
      limit: { type: "integer", minimum: 1, maximum: 25, description: "Rows per list; default 5." },
      budget: BUDGET,
      repository: REPOSITORY,
    },
    required: [],
  },
};

export const REPO_RISK_TOOL: HostToolSpec = {
  name: "repo_risk",
  description:
    "Whether files are risky to touch, before you edit them: hotspot (changes often and recently), bug-fix commits, main owner, files that usually change with it (and whether an import explains it), how many files import it, its health and the tests that cover it. changed_files (the files of a change): leads with a directive: files that may break, partners missing from the change, tests to run, and how far it reaches (localized, moderate, broad). Dependents are a floor over the import index, not a runtime prediction.",
  input_schema: {
    type: "object",
    properties: {
      targets: { type: "array", items: { type: "string" }, description: "Workspace-relative files to assess." },
      changed_files: { type: "array", items: { type: "string" }, description: "The files of one change; switches on the directive." },
      budget: BUDGET,
      repository: REPOSITORY,
    },
    required: [],
  },
};

export const REPO_SYMBOL_TOOL: HostToolSpec = {
  name: "repo_symbol",
  description:
    "The body of one function, method or class, line-numbered, read from the file on disk now: target 'path::Name' or 'path::Type.method'; or a line range 'path:120-180' (at most 200 lines). Use it instead of reading a whole file when you need one symbol; the answer marks it complete, so do not read it again. An ambiguous or unknown name returns the candidates. depth 2 adds the bodies of same-file functions it calls. Symbols are found for Rust, TypeScript, JavaScript, Python, Java, Kotlin, C#, Go, PHP, C++ and Ruby; use a line range for other files.",
  input_schema: {
    type: "object",
    properties: {
      target: { type: "string", description: "path::Name, path::Type.method, or path:start-end." },
      context_lines: { type: "integer", minimum: 0, maximum: 50, description: "Extra lines before and after." },
      depth: { type: "integer", minimum: 1, maximum: 2 },
      repository: REPOSITORY,
    },
    required: ["target"],
  },
};

/** Always offered, like repo_context: in every loop, mode and skill, and in workflow steps. */
export const REPO_AGENT_TOOLS: HostToolSpec[] = [REPO_OVERVIEW_TOOL, REPO_HEALTH_TOOL, REPO_RISK_TOOL, REPO_SYMBOL_TOOL, CODE_GUIDELINES_TOOL];

/** The lines the system prompt lists for these tools. */
export const REPO_AGENT_GUIDES: Record<string, string> = {
  repo_overview: "- 'repo_overview': The shape of an unfamiliar repository: overview, packages, entry points, health, history, where to start (input: {} | {\"include\": [\"outline\"]}). Once per conversation.",
  repo_health: "- 'repo_health': Code health: what to fix first ({}), whether edited files got better or worse ({\"targets\": [\"path\"]}), how to fix one finding ({\"finding\": \"id\"}).",
  repo_risk: "- 'repo_risk': Before editing: hotspots, bug-fix history, owners, co-changing files, dependents, tests ({\"targets\": [\"path\"]}); for a change, what may break and which tests to run ({\"changed_files\": [...]}).",
  repo_symbol: "- 'repo_symbol': One function, method or class body, or a line range, line-numbered from disk ({\"target\": \"path::Name\" | \"path:10-60\"}).",
  code_guidelines: CODE_GUIDELINES_GUIDE,
};

/**
 * When to use which repository tool, built from the tools on offer: one line per question, the
 * order to work in, and how to read an answer. Replaces the per-tool guidelines.
 */
export function repositoryToolsSection(toolNames: string[]): string {
  const has = (name: string) => toolNames.includes(name);
  if (!has("repo_context")) return "";
  const rows = [
    has("repo_overview") && "- New or unfamiliar repository: 'repo_overview', once per conversation (skip it when the repository documentation in this prompt already describes the project).",
    "- What a file or folder is, what it defines and how it connects: 'repo_context' before opening files; put several targets in one call.",
    has("repo_symbol") && "- One function, method or class: 'repo_symbol' with path::Name instead of reading the whole file.",
    has("search_codebase") && "- Text such as strings, configuration and documentation, which the index does not hold: 'search_codebase'.",
    has("repo_risk") && "- Before your first edit to a file: 'repo_risk' on it (several files at once); for a change spanning files, pass them as changed_files to see what may break and which tests to run.",
    "- Before moving, renaming, splitting, merging or deleting files or changing a public name: 'repo_context' mode 'blast_radius' on each file ('orient' on the folder).",
    has("code_guidelines") && "- Before your first edit to a file: 'code_guidelines' mode 'rules' on it, and follow what applies; after your last edit: mode 'check' with changed_only true, and fix every error it reports.",
    has("repo_health") && `- After your last edit to a file: 'repo_health' with the edited files as targets; if a score dropped, fix what it lists${has("run_check") ? ", then verify with 'run_check'" : ""}.`,
    has("repo_health") && "- Asked what to improve or refactor: 'repo_health' with no arguments, then 'repo_health' with a finding id for exact instructions.",
  ].filter(Boolean);
  return `

Repository tools (read-only; prefer them to opening many files or searching):
${rows.join("\n")}
- Reading an answer: 'stale' names files that changed since the index was built, so read those before relying on it; 'complete' means the code was served whole from disk, so do not read it again; 'unsupported' means the language is not analysed, so read the file; 'ignored' lists arguments that were not understood; 'next' holds ready-to-run follow-up calls.`;
}

function failureText(error: unknown): string {
  if (typeof error === "object" && error !== null && "message" in error) {
    const { code, message } = error as { code?: unknown; message?: unknown };
    return typeof code === "string" ? `${code}: ${String(message)}` : String(message);
  }
  return String(error);
}

/** The handler for one of these tools; `activeRepository` is the repository chosen in the IDE. */
export function repoAgentTool(tool: string, workspaceRoot: string, activeRepository?: string): HostToolHandler {
  return async (args) => {
    if (!workspaceRoot.trim()) return { ok: false, error: "No workspace is open, so there is no repository to read." };
    try {
      const output = (await invoke("repository_agent_tool", { root: workspaceRoot, activeRepository: activeRepository ?? null, tool, arguments: args ?? {} })) as { result?: unknown; repository?: unknown };
      return { ok: true, output: JSON.stringify(output.result ? { ...(output.result as object), repository: output.repository } : output) };
    } catch (error: unknown) {
      return { ok: false, error: failureText(error) };
    }
  };
}
