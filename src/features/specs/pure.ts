/** Small pure helpers for the Specs page, kept apart so they are tested without rendering. */
import type { ChangeTab } from "./specsState";
import type { ChangeSummary, NextStep, SpecTask, Status } from "./model";

export const STATUS_TEXT: Record<Status, string> = {
  draft: "Draft",
  specified: "Specified",
  planned: "Planned",
  building: "Building",
  verifying: "Verifying",
  done: "Done",
  archived: "Archived",
};

export const NEXT_STEP_TEXT: Record<NextStep, string> = {
  specify: "Specify",
  plan: "Plan",
  implement: "Implement",
  archive: "Archive",
};

/** Change tabs in reading order, with the file each shows and the step that writes it. */
export const CHANGE_TABS: { id: ChangeTab; label: string; file: string; writtenBy: string }[] = [
  { id: "overview", label: "Overview", file: "change.md", writtenBy: "New change" },
  { id: "spec", label: "Spec", file: "spec.md", writtenBy: "the Specify step" },
  { id: "checklist", label: "Checklist", file: "checklist.md", writtenBy: "the Specify step's Checklist" },
  { id: "research", label: "Research", file: "research.md", writtenBy: "the Plan step, when the spec needs outside knowledge" },
  { id: "design", label: "Design", file: "design.md", writtenBy: "the Plan step" },
  { id: "tasks", label: "Tasks", file: "tasks.md", writtenBy: "the Plan step" },
  { id: "verification", label: "Verification", file: "verification.md", writtenBy: "the Implement step" },
];

/** Statuses in the order the page groups changes, working ones first. */
const GROUP_ORDER: Status[] = ["building", "verifying", "planned", "specified", "draft", "done"];

export interface ChangeGroup {
  status: Status;
  changes: ChangeSummary[];
}

export function groupChanges(changes: readonly ChangeSummary[]): ChangeGroup[] {
  return GROUP_ORDER.map((status) => ({ status, changes: changes.filter((change) => change.status === status) })).filter((group) => group.changes.length > 0);
}

export function progressText(change: Pick<ChangeSummary, "tasksDone" | "tasksTotal">): string {
  return change.tasksTotal ? `${change.tasksDone}/${change.tasksTotal}` : "no tasks";
}

/** The file in `tasks/` that belongs to a task (`T2-sidebar-actions.md` for `T2`), if there is one. */
export function taskDocument(task: Pick<SpecTask, "id">, files: readonly string[]): string | undefined {
  const lower = task.id.toLowerCase();
  return files.find((file) => file.toLowerCase().startsWith(`${lower}-`) || file.toLowerCase() === `${lower}.md`);
}

/** `R1 (C1, C2) · after T1`, or an empty string when the task names nothing. */
export function taskReferences(task: Pick<SpecTask, "requirements" | "criteria" | "after">): string {
  const requirements = task.requirements.join(", ");
  const criteria = task.criteria.length ? ` (${task.criteria.join(", ")})` : "";
  const parts = [requirements ? `${requirements}${criteria}` : "", task.after.length ? `after ${task.after.join(", ")}` : ""].filter(Boolean);
  return parts.join(" · ");
}

/** Today on this machine as `YYYY-MM-DD`. */
export function localDate(now: Date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

const trimSlashes = (path: string) => path.replace(/\\/g, "/").replace(/\/+$/, "");

/** How the workspace reaches the repository at `root`: `rusty-ide/` inside it, "" when it is the workspace, null when it is outside. */
export function workspacePrefix(root: string, workspaceRoot: string | null | undefined): string | null {
  const repository = trimSlashes(root);
  const workspace = trimSlashes(workspaceRoot ?? "");
  if (!workspace || repository === workspace) return "";
  return repository.startsWith(`${workspace}/`) ? `${repository.slice(workspace.length + 1)}/` : null;
}

/** The parts a linked change names, with the folder each repository has in the workspace. */
export function linkedParts(links: readonly string[], workspaceRoot: string): { repository: string; dir: string; path: string }[] {
  return links.flatMap((link) => {
    const at = link.lastIndexOf("/");
    if (at <= 0 || at === link.length - 1) return [];
    const repository = link.slice(0, at);
    return [{ repository, dir: link.slice(at + 1), path: `${trimSlashes(workspaceRoot)}/${repository}` }];
  });
}

export const FOREIGN_NAME: Record<"open_spec" | "spec_kit", string> = { open_spec: "OpenSpec", spec_kit: "Spec Kit" };

/** `OpenSpec found in openspec: 2 capabilities, 1 change (3 finished ones are not imported).` */
export function foreignSummary(found: { source: "open_spec" | "spec_kit"; path: string; capabilities: number; changes: number; archived: number }): string {
  const parts = [found.capabilities ? `${found.capabilities} ${found.capabilities === 1 ? "capability" : "capabilities"}` : "", found.changes ? `${found.changes} ${found.changes === 1 ? "change" : "changes"}` : ""].filter(Boolean);
  const archived = found.archived ? ` (${found.archived} finished ones are not imported)` : "";
  return `${FOREIGN_NAME[found.source]} found in ${found.path}: ${parts.join(", ") || "a project file"}${archived}.`;
}

/** What an export wrote, for a notification. */
export function exportSummary(target: "open_spec" | "spec_kit", report: { written: string[]; skipped: string[] }): string {
  const written = report.written.length ? `Wrote ${report.written.length} file${report.written.length === 1 ? "" : "s"} in the ${FOREIGN_NAME[target]} layout.` : `Nothing new to write for ${FOREIGN_NAME[target]}.`;
  const skipped = report.skipped.length ? ` Left alone: ${report.skipped.join("; ")}.` : "";
  return `${written}${skipped}`;
}

/** What an import did, for a notification. */
export function importSummary(report: { project: boolean; capabilities: string[]; changes: string[]; skipped: string[] }): string {
  const parts = [report.project ? "the project file" : "", report.capabilities.length ? `${report.capabilities.length} capabilit${report.capabilities.length === 1 ? "y" : "ies"}` : "", report.changes.length ? `${report.changes.length} change${report.changes.length === 1 ? "" : "s"}` : ""].filter(Boolean);
  const skipped = report.skipped.length ? ` Left alone: ${report.skipped.join("; ")}.` : "";
  return `${parts.length ? `Imported ${parts.join(", ")}.` : "Nothing new to import."}${skipped}`;
}
