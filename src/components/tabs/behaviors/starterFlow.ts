import { stableStringify, type JsonObject } from "./behaviorModel";
import catalog from "./starter/catalog.json";
import previousQueueWorkflow from "./starter/legacy/before-task-queue/plan-build-verify.workflow.json";
const workflow = catalog.workflows[0];
import v1 from "./starter/legacy/v1/plan-build-verify.workflow.json";
import v2 from "./starter/legacy/v2/plan-build-verify.workflow.json";
import v3 from "./starter/legacy/v3/plan-build-verify.workflow.json";
import v4 from "./starter/legacy/v4/plan-build-verify.workflow.json";
import v5 from "./starter/legacy/v5/plan-build-verify.workflow.json";

export const STARTER_WORKFLOW_ID = "plan-build-verify";
export const BUILTIN_WORKFLOW_PATH = "builtin:plan-build-verify";
export const STARTER_SEEDED_STORAGE_KEY = "rusty_starter_flow_seeded";

const BUILTIN_PATH_PREFIX = "builtin:";
const BUILTIN_ID_PREFIX = "rusty-ide.builtin.";

// Built-ins are displayed as app-owned, read-only documents. The native
// workflow host registers the same prefixed IDs for executable sessions.
// Keep this list in step with `BUILTIN_PROFILES` in src-tauri/src/harness/workflow.rs.
export const STARTER_PROFILES = catalog.profiles.map((profile) => ({
  ...profile,
  id: `${BUILTIN_ID_PREFIX}${profile.id}`,
})) as unknown as JsonObject[];

interface BundledWorkflow {
  id: string;
  nodes: Array<{ config: Record<string, unknown> }>;
}

/** A bundled workflow as the app exposes it: its id and the profiles its
 * steps name carry the built-in namespace. */
function builtinWorkflow<T extends BundledWorkflow>(source: T): JsonObject {
  return {
    ...source,
    id: `${BUILTIN_ID_PREFIX}${source.id}`,
    nodes: source.nodes.map((node) => {
      const profile = node.config.profile as { id: string } | undefined;
      const queue = node.config.task_queue as { review_profile: { id: string } } | undefined;
      return { ...node, config: { ...node.config, ...(queue ? { task_queue: { ...queue, review_profile: { id: `${BUILTIN_ID_PREFIX}${queue.review_profile.id}` } } } : {}), ...(profile ? { profile: { id: `${BUILTIN_ID_PREFIX}${profile.id}` } } : {}) } };
    }),
  } as unknown as JsonObject;
}

export const STARTER_WORKFLOW = builtinWorkflow(workflow);

/**
 * Every built-in workflow, in the order the Agent's Mode picker lists them:
 * the everyday Plan, build, verify first, then the stages, then the other
 * end-to-end pipelines.
 *
 * Stages are short, mostly read-only runs that stop at a handoff the user can
 * read and amend; the next stage picks that result up as its context, so a
 * long job can be steered between stages. End-to-end workflows run a whole
 * pipeline unattended.
 */
export const STARTER_WORKFLOWS: JsonObject[] = catalog.workflows.map(builtinWorkflow);

export type BuiltinWorkflowKind = "stage" | "end_to_end";

export function builtinWorkflowPath(id: string): string {
  return `${BUILTIN_PATH_PREFIX}${id.startsWith(BUILTIN_ID_PREFIX) ? id.slice(BUILTIN_ID_PREFIX.length) : id}`;
}

const STARTER_PATHS = STARTER_WORKFLOWS.map((document) => builtinWorkflowPath(String(document.id)));

/** The built-in workflow paths, in picker order. */
export function starterWorkflowPaths(): string[] {
  return [...STARTER_PATHS];
}

export function isStarterWorkflowPath(path: string): boolean {
  return STARTER_PATHS.includes(path);
}

/** Whether a workflow is a short stage (as opposed to an end-to-end pipeline). */
export function workflowKind(document: JsonObject | undefined): BuiltinWorkflowKind | undefined {
  const kind = (document?.metadata as JsonObject | undefined)?.kind;
  return kind === "stage" || kind === "end_to_end" ? kind : undefined;
}

export function isUnmodifiedStarter(document: JsonObject): boolean {
  return [v1, v2, v3, v4, v5, previousQueueWorkflow, workflow].some((version) => stableStringify(version as unknown as JsonObject) === stableStringify(document));
}

/** An independent copy of a built-in workflow; the default is Plan, build, verify. */
export function builtinWorkflowDocument(path: string = BUILTIN_WORKFLOW_PATH): JsonObject {
  const document = STARTER_WORKFLOWS[STARTER_PATHS.indexOf(path)];
  if (!document) throw new Error(`No built-in workflow at ${path}`);
  return JSON.parse(JSON.stringify(document)) as JsonObject;
}
