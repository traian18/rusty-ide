/**
 * Which model a run's model requests were really sent to, when a capability's
 * `prepareExecution` changed it (AUTO choosing a model per workflow step).
 * rusty-core stamps a step's usage with the model it configured for the
 * session, so the run's accounting asks here for the model that ran instead.
 * Kept in the run's `RunContext.scratch`, keyed by the request's run id.
 */
const KEY = "appliedModels";

export function recordAppliedModel(scratch: Record<string, unknown>, runId: string, model: string): void {
  ((scratch[KEY] ??= new Map<string, string>()) as Map<string, string>).set(runId, model);
}

export function appliedModel(scratch: Record<string, unknown>, runId: string | null | undefined): string | undefined {
  return runId ? (scratch[KEY] as Map<string, string> | undefined)?.get(runId) : undefined;
}
