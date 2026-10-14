/**
 * Names for the built-in workflows. The workflows and profiles themselves --
 * built-in and saved -- are listed by the workflow catalog service
 * (src/services/workflowCatalogService.ts).
 */
import type { JsonObject } from "./behaviorModel";

export const STARTER_WORKFLOW_ID = "plan-build-verify";
export const BUILTIN_WORKFLOW_PATH = "builtin:plan-build-verify";

/** The id Plan, build, verify runs under. */
export const BUILTIN_WORKFLOW_ID = "rusty-ide.builtin.plan-build-verify";

const BUILTIN_PATH_PREFIX = "builtin:";

/** Whether `path` names a built-in (read-only) workflow. */
export function isBuiltinWorkflowPath(path: string): boolean {
  return path.startsWith(BUILTIN_PATH_PREFIX);
}

export type BuiltinWorkflowKind = "stage" | "end_to_end";

/** Whether a workflow is a short stage (as opposed to an end-to-end pipeline). */
export function workflowKind(document: JsonObject | undefined): BuiltinWorkflowKind | undefined {
  const kind = (document?.metadata as JsonObject | undefined)?.kind;
  return kind === "stage" || kind === "end_to_end" ? kind : undefined;
}
