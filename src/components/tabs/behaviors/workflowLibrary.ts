/**
 * Which other workflows a workflow runs: the `subflow` nodes' flow targets
 * and the flows a task queue offers its tasks. A run is sent the saved ones
 * (the built-in workflows are always known to the host).
 */

import { type JsonObject, isObject, stepConfig, stepsOf } from "./behaviorModel";

const BUILTIN_PREFIX = "rusty-ide.builtin.";

/** Ids of the saved flows `workflow` names directly, in order of appearance. */
export function referencedFlowIds(workflow: JsonObject): string[] {
  const ids: string[] = [];
  const add = (target: unknown) => {
    if (isObject(target) && target.type === "flow" && typeof target.id === "string" && target.id && !ids.includes(target.id)) {
      ids.push(target.id);
    }
  };
  for (const step of stepsOf(workflow)) {
    const config = stepConfig(step);
    if (step.type === "subflow") add(config.target);
    const queue = config.task_queue;
    if (isObject(queue) && isObject(queue.flows)) Object.values(queue.flows).forEach(add);
  }
  return ids;
}

/**
 * The workflows from `available` that `workflow` runs, directly or through
 * the flows it runs, leaving out `workflow` itself and the built-in ones.
 */
export function workflowLibraryFor(workflow: JsonObject, available: JsonObject[]): JsonObject[] {
  const byId = new Map(available.map((document) => [String(document.id), document]));
  const library: JsonObject[] = [];
  const seen = new Set<string>([String(workflow.id)]);
  const pending = referencedFlowIds(workflow);
  while (pending.length) {
    const id = pending.shift()!;
    if (seen.has(id) || id.startsWith(BUILTIN_PREFIX)) continue;
    seen.add(id);
    const document = byId.get(id);
    if (!document) continue;
    library.push(document);
    pending.push(...referencedFlowIds(document));
  }
  return library;
}
