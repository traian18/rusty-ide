/** The starter is bundled with the app; it never needs workspace files. */
import { stableStringify, type JsonObject } from "./behaviorModel";
import workflow from "./starter/plan-build-verify.workflow.json";
import plan from "./starter/plan.profile.json";
import build from "./starter/build.profile.json";
import v1 from "./starter/v1/plan-build-verify.workflow.json";
import v2 from "./starter/v2/plan-build-verify.workflow.json";

export const STARTER_WORKFLOW_ID = "plan-build-verify";
export const BUILTIN_WORKFLOW_PATH = "builtin:plan-build-verify";
export const STARTER_SEEDED_STORAGE_KEY = "rusty_starter_flow_seeded";
export const STARTER_PROFILES = [plan, build].map((profile) => ({
  ...profile, id: `rusty-ide.builtin.${profile.id}`,
})) as unknown as JsonObject[];
export const STARTER_WORKFLOW = {
  ...workflow,
  id: "rusty-ide.builtin.plan-build-verify",
  nodes: workflow.nodes.map((node) => ({ ...node, config: {
    ...node.config,
    ...("profile" in node.config && node.config.profile ? { profile: { id: `rusty-ide.builtin.${node.config.profile.id}` } } : {}),
  } })),
} as unknown as JsonObject;

export function isStarterWorkflowPath(path: string): boolean {
  return path === BUILTIN_WORKFLOW_PATH;
}

/** Only exact shipped documents are generated files; edited copies are user workflows. */
export function isUnmodifiedStarter(document: JsonObject): boolean {
  return [v1, v2, workflow].some((version) => stableStringify(version as unknown as JsonObject) === stableStringify(document));
}

export function builtinWorkflowDocument(): JsonObject {
  return JSON.parse(JSON.stringify(STARTER_WORKFLOW)) as JsonObject;
}
