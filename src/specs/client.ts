/** The specs page's window to Tauri; everything else receives a [`SpecsClient`] so tests use a plain fake. */
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

import type { CreatedChange, CreatedPart, NewChangeRequest, SwitchedPart, ExportReport, ForeignKind, ForeignSource, ImportReport, SpecArchived, SpecDocumentInput, SpecProgress, SpecProgressRecorded, SpecQueuePlans, SpecRecorded, SpecStep, SpecsOverview, SpecTask } from "./model";

export interface SpecsClient {
  overview(root: string): Promise<SpecsOverview>;
  /** The text of a file under the specs root, or null when it does not exist. */
  document(root: string, path: string): Promise<string | null>;
  tasks(root: string, change: string): Promise<SpecTask[]>;
  /** Writes the README and project.md where missing; returns the paths it created. */
  init(root: string): Promise<string[]>;
  createChange(root: string, request: NewChangeRequest): Promise<CreatedChange>;
  /** One change per repository in `roots`, linked to each other; `main` holds the whole change's spec. */
  createLinkedChange(workspace: string, roots: string[], main: string, request: NewChangeRequest): Promise<CreatedPart[]>;
  /** Switches the change's repository and every linked part to the change's branch. */
  switchLinked(workspace: string | null, root: string, change: string): Promise<SwitchedPart[]>;
  tick(root: string, change: string, task: string, done: boolean): Promise<void>;
  /** The text a Specify or Plan run starts from, composed from the files now. `workspace` is the folder the run works in, when it holds the repository. */
  context(root: string, change: string, step: SpecStep, workspace?: string): Promise<string>;
  /** Writes a run's documents into the change and moves its status on. */
  record(root: string, change: string, step: SpecStep, documents: SpecDocumentInput[], date: string): Promise<SpecRecorded>;
  /** The whole spec and the unticked tasks, as the task queue's plans. */
  queuePlan(root: string, change: string): Promise<SpecQueuePlans>;
  /** Ticks finished tasks, writes their documents and verification.md, and moves the status on. */
  progress(root: string, change: string, progress: SpecProgress, date: string): Promise<SpecProgressRecorded>;
  /** Merges a finished change into the capability specs and moves it to the archive. `force` archives one that is not done. */
  archive(root: string, change: string, date: string, force: boolean): Promise<SpecArchived>;
  /** OpenSpec and Spec Kit folders found in the repository. */
  foreign(root: string): Promise<ForeignSource[]>;
  /** Converts one of them into this layout; the source stays and nothing existing is overwritten. */
  importForeign(root: string, source: ForeignKind, date: string): Promise<ImportReport>;
  /** Writes these specs in another tool's layout; the specs here stay the source and nothing existing there is overwritten. */
  exportTo(root: string, target: ForeignKind, date: string): Promise<ExportReport>;
  /** Calls back when files in the workspace change; resolves to the function that stops listening. */
  onChanged(callback: () => void): Promise<() => void>;
}

export const specsClient: SpecsClient = {
  overview: (root) => invoke<SpecsOverview>("specs_overview", { root }),
  document: (root, path) => invoke<string | null>("specs_document", { root, path }),
  tasks: (root, change) => invoke<SpecTask[]>("specs_tasks", { root, change }),
  init: (root) => invoke<string[]>("specs_init", { root }),
  createChange: (root, { title, description, date, branch }) => invoke<CreatedChange>("specs_change_create", { root, title, description, date, branch }),
  createLinkedChange: (workspace, roots, main, { title, description, date, branch }) => invoke<CreatedPart[]>("specs_linked_change_create", { workspace, roots, main, title, description, date, branch }),
  switchLinked: (workspace, root, change) => invoke<SwitchedPart[]>("specs_linked_switch", { workspace, root, change }),
  tick: (root, change, task, done) => invoke<void>("specs_task_tick", { root, change, task, done }),
  context: (root, change, step, workspace) => invoke<string>("specs_context", { root, change, step, workspace: workspace ?? null }),
  record: (root, change, step, documents, date) => invoke<SpecRecorded>("specs_record", { root, change, step, documents, date }),
  queuePlan: (root, change) => invoke<SpecQueuePlans>("specs_queue_plan", { root, change }),
  progress: (root, change, progress, date) => invoke<SpecProgressRecorded>("specs_progress", { root, change, progress, date }),
  archive: (root, change, date, force) => invoke<SpecArchived>("specs_archive", { root, change, date, force }),
  foreign: (root) => invoke<ForeignSource[]>("specs_foreign", { root }),
  importForeign: (root, source, date) => invoke<ImportReport>("specs_import", { root, source, date }),
  exportTo: (root, target, date) => invoke<ExportReport>("specs_export", { root, target, date }),
  onChanged: (callback) => listen("workspace-fs-changed", () => callback()),
};
