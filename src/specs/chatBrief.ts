/** The text a chat is given about the specs: the tool's answers and the short brief about the active change. */
import type { ChangeSummary, SpecsOverview, SpecTask } from "./model";
import { progressText, STATUS_TEXT, taskReferences } from "./pure";

/** The documents `spec_context` can return, by the name the model uses. */
export const SPEC_DOCUMENTS: Record<string, string> = {
  change: "change.md",
  spec: "spec.md",
  research: "research.md",
  design: "design.md",
  tasks: "tasks.md",
  verification: "verification.md",
};

const MAX_DOCUMENT_CHARS = 20_000;
const BRIEF_TASKS = 8;

const numbered = (change: Pick<ChangeSummary, "number">) => (change.number !== null ? `${String(change.number).padStart(4, "0")} ` : "");

/** What exists: the project, the capabilities and every change with its status, progress and next step. */
export function formatSpecList(overview: SpecsOverview): string {
  if (!overview.exists && !overview.changes.length) return `There are no specs in this repository yet (they live under ${overview.root}/).`;
  const lines = [`Specs under ${overview.root}/.`, ""];
  lines.push(overview.project ? `- project: ${overview.root}/project.md` : "- project: none yet");
  for (const capability of overview.capabilities) {
    lines.push(`- capability ${capability.name}: ${capability.title}${capability.purpose ? ` (${capability.purpose})` : ""}, ${capability.requirements} requirements, ${capability.path}`);
  }
  for (const change of overview.changes) {
    const open = change.openQuestions ? `, ${change.openQuestions} open question${change.openQuestions === 1 ? "" : "s"}` : "";
    const next = change.nextStep ? `, next: ${change.nextStep}` : "";
    lines.push(`- change ${change.dir}: ${numbered(change)}${change.title}, ${STATUS_TEXT[change.status].toLowerCase()}, tasks ${progressText(change)}${open}${next}`);
  }
  lines.push("", "Call again with {\"change\": \"<folder>\"} for one change's spec, design and open tasks.");
  return lines.join("\n");
}

/** The unticked tasks, one per line, with what each satisfies. */
function openTasks(tasks: readonly SpecTask[], limit = Infinity): string[] {
  const open = tasks.filter((task) => !task.done);
  const shown = open.slice(0, limit).map((task) => {
    const refs = taskReferences(task);
    return `- ${task.id} ${task.title}${refs ? ` (${refs})` : ""}`;
  });
  if (open.length > shown.length) shown.push(`- … and ${open.length - shown.length} more`);
  return shown;
}

function clip(text: string): string {
  return text.length > MAX_DOCUMENT_CHARS ? `${text.slice(0, MAX_DOCUMENT_CHARS)}\n[… the rest is omitted; read the file for it]` : text;
}

/** One change: its status line, the open tasks, and the documents asked for. */
export function formatChange(specsRoot: string, change: ChangeSummary, tasks: readonly SpecTask[], documents: readonly { name: string; text: string | null }[]): string {
  const folder = `${specsRoot}/changes/${change.dir}`;
  const lines = [
    `Change ${numbered(change)}${change.title} (${folder}/): ${STATUS_TEXT[change.status].toLowerCase()}, tasks ${progressText(change)}${change.branch ? `, branch ${change.branch}` : ""}.`,
  ];
  if (change.hint) lines.push(change.hint);
  const problems = change.warnings.filter((warning) => warning.severity !== "note");
  if (problems.length) lines.push(`Problems the checks found: ${problems.map((p) => p.message).join("; ")}.`);
  const open = openTasks(tasks);
  lines.push("", open.length ? "Open tasks:" : tasks.length ? "Every task is ticked." : "There are no tasks yet.", ...open);
  for (const document of documents) {
    lines.push("", `## ${document.name} (${folder}/${SPEC_DOCUMENTS[document.name] ?? document.name})`, "", document.text === null ? "This document does not exist yet." : clip(document.text.trim()));
  }
  return lines.join("\n");
}

/** The short section added to the agent's instructions while a change is the active one. */
export function formatActiveBrief(specsRoot: string, change: ChangeSummary, tasks: readonly SpecTask[]): string {
  const lines = [
    "## Active spec change",
    `The person is working on change ${numbered(change)}${change.title} (${STATUS_TEXT[change.status].toLowerCase()}, tasks ${progressText(change)}), in ${specsRoot}/changes/${change.dir}/.`,
  ];
  const open = openTasks(tasks, BRIEF_TASKS);
  if (open.length) lines.push("Open tasks:", ...open);
  if (change.openQuestions) lines.push(`The spec has ${change.openQuestions} open question${change.openQuestions === 1 ? "" : "s"}.`);
  lines.push(`Call spec_context with {"change": "${change.dir}"} to read its spec, design and tasks before changing code for it. The spec files are the source of truth: when a requirement changes, change the spec first.`);
  return lines.join("\n");
}
