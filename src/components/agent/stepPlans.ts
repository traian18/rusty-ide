/** The plans of a workflow run's steps, in the order the steps made them. */
import type { Todo } from "../../harness/core/definitions/todoTool";

export interface StepPlan {
  /** One step session: a retry or a queued task's session has its own. */
  key: string;
  /** The step's name. */
  step: string;
  /** What the panel calls it: the step's name, numbered from its second list on. */
  label: string;
  todos: Todo[];
}

/** Updates the list of `step.key`, or adds it after the others. */
export function mergeStepPlan(plans: readonly StepPlan[], step: { key: string; name: string }, todos: Todo[]): StepPlan[] {
  if (plans.some((plan) => plan.key === step.key)) return plans.map((plan) => (plan.key === step.key ? { ...plan, todos } : plan));
  const earlier = plans.filter((plan) => plan.step === step.name).length;
  return [...plans, { key: step.key, step: step.name, label: earlier ? `${step.name} (${earlier + 1})` : step.name, todos }];
}

export const doneCount = (todos: readonly Todo[]) => todos.filter((todo) => todo.status === "completed").length;
