/**
 * workflowReport.ts -- keeping what a workflow found.
 *
 * A workflow ends in its Result node, and a chat message scrolls away. When a
 * run only looked (researched, analyzed, reviewed, planned) and changed
 * nothing, its Result is the thing the user will want to pick up later, so it
 * is saved as Markdown under `.rusty/findings/`. When a run changed files, the
 * changes are the outcome and no report is written. Pure, so the rule is
 * testable apart from the tab that applies it.
 */

export const WORKFLOW_REPORT_DIR = ".rusty/findings";

/** What the chat shows when a run produced no text; nothing worth keeping. */
const NO_RESULT = /^(Agent complete\.|The workflow completed without output\.)$/;

const MAX_TITLE_CHARS = 100;
const MAX_REQUEST_CHARS = 2_000;
const MAX_SLUG_CHARS = 48;

export interface WorkflowReportInput {
  workflowName: string;
  /** What the user asked for. */
  request: string;
  /** The workflow's Result, as shown in the chat. */
  text: string;
  /** Files the run changed. Any at all means the changes are the outcome. */
  changedFiles: readonly string[];
  now?: Date;
}

export interface WorkflowReport {
  /** Relative to the workspace root, with forward slashes. */
  path: string;
  content: string;
}

const pad = (value: number, width = 2) => String(value).padStart(width, "0");

function slugOf(text: string): string {
  const slug = text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_SLUG_CHARS)
    .replace(/-+$/g, "");
  return slug || "result";
}

/** The report to save for a finished run, or `undefined` when none should be. */
export function workflowReportFor({ workflowName, request, text, changedFiles, now = new Date() }: WorkflowReportInput): WorkflowReport | undefined {
  const result = text.trim();
  if (changedFiles.length > 0 || !result || NO_RESULT.test(result)) return undefined;

  const asked = request.trim();
  const firstLine = asked.split("\n", 1)[0].trim();
  const title = firstLine.length > MAX_TITLE_CHARS ? `${firstLine.slice(0, MAX_TITLE_CHARS).trimEnd()}…` : firstLine;
  const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  const clippedRequest = asked.length > MAX_REQUEST_CHARS ? `${asked.slice(0, MAX_REQUEST_CHARS)}\n[… ${asked.length - MAX_REQUEST_CHARS} more characters omitted]` : asked;

  return {
    path: `${WORKFLOW_REPORT_DIR}/${stamp}-${slugOf(title || workflowName)}.md`,
    content: [
      `# ${title || workflowName}`,
      "",
      `- Workflow: ${workflowName}`,
      `- Saved: ${now.toISOString()}`,
      "",
      ...(clippedRequest ? ["## Request", "", clippedRequest, ""] : []),
      "## Result",
      "",
      result,
      "",
    ].join("\n"),
  };
}
