import type { JsonObject } from "../model";
import { isObject } from "../model";

export function upstreamPlanBinding(step: JsonObject): string {
  const bindings = Array.isArray(step.input_bindings) ? (step.input_bindings as JsonObject[]) : [];
  const plan = bindings.find((binding) => isObject(binding.source) && binding.source.type === "node_output" && binding.target === "plan");
  return String(plan?.target ?? "plan");
}

/** A task queue as built-in flows use it: each task planned in detail, built, then checked by a read-only reviewer; an "ask me" failure policy. */
export function taskQueueDefaults(profileIds: string[], plan: string): JsonObject {
  const named = (role: string) => profileIds.find((id) => id === role || id.endsWith(`.${role}`)) ?? role;
  return {
    plan_pointer: `/${plan}`,
    review_profile: { id: named("review") },
    review_instructions: "Review the change made for workflow_input.task against its acceptance criteria. Read the changed code; do not edit. Give evidence from the workspace for each criterion the task names.",
    task_planner: {
      profile: { id: named("plan") },
      instructions: "Plan workflow_input.task in detail before it is built: read the code it touches, then list in order the files and symbols to change and how, the tests to add, the checks to run, and how each criterion it names is met. Do not change files; your reply is the plan the builder follows.",
    },
    max_repairs: 2,
    on_task_failure: "ask",
  };
}
