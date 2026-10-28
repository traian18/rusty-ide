// ============================================================
// definitions/guidelinesTool.ts -- code_guidelines: the project's own style and rules
// (.rusty/guidelines/rules.json and style.md), answered by the host from the files on disk.
// Three uses: the model reads what applies before editing ('rules') and checks its work
// ('check'); every edit_file / write_file result gets a short notice when the edit broke a rule;
// and the completion gate calls it with {gate: true}, which checks the files the run changed and
// fails while the change introduced a guideline error.
// ============================================================

import { invoke } from "@tauri-apps/api/core";

import type { HostToolHandler } from "../CoreHarness";
import type { HostToolSpec } from "../SessionRecipe";

export const CODE_GUIDELINES_TOOL: HostToolSpec = {
  name: "code_guidelines",
  description:
    "The project's own code guidelines (.rusty/guidelines): rules (patterns that must not appear, size and complexity limits, imports one part of the code must not make), prose style guidance per folder, and code health thresholds. mode 'rules' with targets: what applies to those files; read it before your first edit to a file. mode 'check' with targets: violations in the files as they are on disk now, by line, with how to fix them; changed_only true reports only what the uncommitted change introduced. Status not_configured means the project has no guidelines: follow the surrounding code. Errors must be fixed before you finish; warnings should be.",
  input_schema: {
    type: "object",
    properties: {
      mode: { type: "string", enum: ["rules", "check"] },
      targets: { type: "array", items: { type: "string" }, description: "Workspace-relative files." },
      changed_only: { type: "boolean", description: "check: only what the uncommitted change introduced." },
      budget: { type: "integer", minimum: 1000, maximum: 24000, description: "Approximate answer size in characters." },
      repository: { type: "string", description: "Which repository, by name or path, when the workspace holds several. Optional when a path names it." },
    },
    required: [],
  },
};

export const CODE_GUIDELINES_GUIDE =
  "- 'code_guidelines': The project's style and rules: what applies before editing ({\"mode\": \"rules\", \"targets\": [\"path\"]}), what an edit broke ({\"mode\": \"check\", \"targets\": [\"path\"], \"changed_only\": true}).";

/** How long an edit waits for its guideline notice before going on without it. */
const NOTICE_DEADLINE_MS = 3000;
/** Violations an edit notice lists. */
const NOTICE_LINES = 3;

interface Violation { rule?: string; severity?: string; lines?: string; message?: string; in?: string | null }
interface FileSection { path?: string; violations?: Violation[] }
interface ToolResult { status?: string; summary?: string; sections?: Record<string, unknown> }

/** The part results of an answer: one, or one per repository when the paths were split. */
function parts(result: ToolResult): ToolResult[] {
  const sections = result.sections ?? {};
  if ("files" in sections || "errors" in sections || !("split" in result)) return [result];
  return Object.values(sections).filter((part): part is ToolResult => typeof part === "object" && part !== null);
}

function errorsIn(result: ToolResult): number {
  return parts(result).reduce((sum, part) => sum + (Number(part.sections?.errors) || 0), 0);
}

function violationsIn(result: ToolResult): Array<Violation & { path: string }> {
  return parts(result).flatMap((part) => ((part.sections?.files as FileSection[] | undefined) ?? [])
    .flatMap((file) => (file.violations ?? []).map((v) => ({ ...v, path: String(file.path ?? "") }))));
}

async function callHost(workspaceRoot: string, activeRepository: string | undefined, args: Record<string, unknown>): Promise<ToolResult & { repository?: unknown }> {
  const output = (await invoke("repository_agent_tool", { root: workspaceRoot, activeRepository: activeRepository ?? null, tool: "code_guidelines", arguments: args })) as { result?: ToolResult; repository?: unknown };
  return { ...(output.result ?? (output as ToolResult)), repository: output.repository };
}

/** `absolute` relative to the workspace, or itself when it is outside or already relative. */
export function workspaceRelative(workspaceRoot: string, absolute: string): string {
  const root = workspaceRoot.replace(/[\\/]+$/, "");
  const normalized = absolute.replace(/\\/g, "/");
  const prefix = `${root.replace(/\\/g, "/")}/`;
  return normalized.startsWith(prefix) ? normalized.slice(prefix.length) : normalized;
}

function failureText(error: unknown): string {
  if (typeof error === "object" && error !== null && "message" in error) return String((error as { message: unknown }).message);
  return String(error);
}

function describe(v: Violation & { path: string }): string {
  return `${v.path}:${v.lines ?? "?"} [${v.rule ?? "rule"}] ${v.message ?? ""}`.trim();
}

/** The gate: fails while the files this run changed hold guideline errors the change introduced. */
async function gate(workspaceRoot: string, activeRepository: string | undefined, modifiedFiles: Set<string>) {
  const targets = [...modifiedFiles].map((file) => workspaceRelative(workspaceRoot, file));
  if (targets.length === 0) return { ok: true as const, output: "No files changed, so there is nothing to check against the guidelines." };
  const result = await callHost(workspaceRoot, activeRepository, { mode: "check", targets, changed_only: true });
  if (result.status === "not_configured") return { ok: true as const, output: "The project has no code guidelines." };
  if (result.status === "invalid") return { ok: true as const, output: `The guidelines could not be checked: ${result.summary ?? "the rules file has mistakes"}.` };
  const errors = errorsIn(result);
  if (errors === 0) return { ok: true as const, output: result.summary ?? "No guideline errors." };
  const listed = violationsIn(result).filter((v) => v.severity === "error").slice(0, 10).map(describe);
  return {
    ok: false as const,
    error: `Your change breaks the project's code guidelines (${errors} error(s)). Fix each one, then call code_guidelines with mode check and changed_only true to confirm:\n${listed.map((line) => `- ${line}`).join("\n")}`,
  };
}

/**
 * code_guidelines for a run that edits files: `{gate: true}` (what the completion gate sends)
 * checks the files the run changed; anything else goes to the host as the model wrote it.
 */
export function codeGuidelinesTool(workspaceRoot: string, activeRepository: string | undefined, modifiedFiles: Set<string>): HostToolHandler {
  return async (args) => {
    if (!workspaceRoot.trim()) return { ok: false, error: "No workspace is open, so there are no guidelines to read." };
    const input = (args ?? {}) as Record<string, unknown>;
    try {
      if (input.gate === true) return await gate(workspaceRoot, activeRepository, modifiedFiles);
      const { gate: _ignored, ...rest } = input;
      const result = await callHost(workspaceRoot, activeRepository, rest);
      return { ok: true, output: JSON.stringify(result) };
    } catch (error: unknown) {
      // The gate must never hold a run back because the check itself could not run.
      if (input.gate === true) return { ok: true, output: `The guidelines could not be checked: ${failureText(error)}` };
      return { ok: false, error: failureText(error) };
    }
  };
}

/** The notice an edit's result ends with, or "" when the edit broke no guideline. */
export function guidelineNotice(result: ToolResult): string {
  if (result.status !== "violations" && result.status !== "ok") return "";
  const found = violationsIn(result);
  if (found.length === 0) return "";
  const errors = found.filter((v) => v.severity === "error").length;
  const shown = found.slice(0, NOTICE_LINES).map((v) => `- ${v.severity ?? "error"}: ${describe(v)}`);
  const more = found.length > NOTICE_LINES ? `\n- and ${found.length - NOTICE_LINES} more (code_guidelines mode check lists them)` : "";
  const lead = errors > 0 ? `Guidelines: this edit introduced ${errors} error(s); fix them before finishing.` : "Guidelines: this edit introduced warnings.";
  return `\n\n${lead}\n${shown.join("\n")}${more}`;
}

function editedPath(args: unknown): string {
  return String((args as { path?: unknown } | undefined)?.path ?? "").trim();
}

/**
 * An edit tool whose successful result says what the edit broke of the guidelines. The check is
 * best effort: past a short deadline, or when it fails, the edit's result is returned as it is.
 */
export function withGuidelineNotices(handler: HostToolHandler, workspaceRoot: string, activeRepository: string | undefined): HostToolHandler {
  return async (args, signal, observer, call) => {
    const outcome = await handler(args, signal, observer, call);
    const path = editedPath(args);
    if (!outcome.ok || !path || !workspaceRoot.trim()) return outcome;
    const target = workspaceRelative(workspaceRoot, path);
    const check = callHost(workspaceRoot, activeRepository, { mode: "check", targets: [target], changed_only: true }).catch(() => undefined);
    const deadline = new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), NOTICE_DEADLINE_MS));
    const result = await Promise.race([check, deadline]);
    const notice = result ? guidelineNotice(result) : "";
    return notice ? { ...outcome, output: `${outcome.output}${notice}` } : outcome;
  };
}
