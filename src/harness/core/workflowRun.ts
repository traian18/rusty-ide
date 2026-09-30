/**
 * workflowRun.ts — reading a rusty-core workflow run as it streams in.
 *
 * A workflow run (a `.rusty/workflows/*.json` orchestration started with
 * `harness_start_workflow`) reports committed orchestration events and a
 * final run state over the session's bridge. These helpers turn them into
 * what a capability run shows: log lines, per-step progress, and the
 * outcome. Pure, so the mapping is testable without a session.
 */

export type WorkflowStepStatus = "running" | "waiting" | "retry" | "succeeded" | "failed";

export interface WorkflowStepProgress {
  nodeId: string;
  name?: string;
  status: WorkflowStepStatus;
  attempt: number;
  message?: string;
}

/** Mirrors `OrchestrationEventEnvelope` (only what the IDE reads). */
export interface WorkflowEventEnvelope {
  sequence?: number;
  event: { type: string; [key: string]: unknown };
}

export type WorkflowOutcome =
  | { status: "completed"; output: unknown }
  | { status: "failed"; code: string; message: string }
  | { status: "cancelled" };

/** Step names by id, from a workflow document, for readable log lines. */
export function stepNames(definition: unknown): Record<string, string> {
  const names: Record<string, string> = {};
  const nodes = (definition as { nodes?: unknown } | null)?.nodes;
  if (!Array.isArray(nodes)) return names;
  for (const node of nodes) {
    if (node && typeof node === "object" && typeof (node as { id?: unknown }).id === "string") {
      const { id, name } = node as { id: string; name?: unknown };
      names[id] = typeof name === "string" && name ? name : id;
    }
  }
  return names;
}

function errorText(error: unknown): string {
  if (error && typeof error === "object") {
    const { message, code } = error as { message?: unknown; code?: unknown };
    if (typeof message === "string" && message) return message;
    if (typeof code === "string") return code;
  }
  return "unknown error";
}

/** What one orchestration event means for the UI. */
export function describeWorkflowEvent(
  envelope: WorkflowEventEnvelope,
  names: Record<string, string>,
): { log?: string; step?: WorkflowStepProgress } {
  const event = envelope.event;
  const nodeId = typeof event.node_id === "string" ? event.node_id : "";
  const name = names[nodeId] ?? nodeId;
  const attempt = typeof event.attempt === "number" ? event.attempt : 1;
  switch (event.type) {
    case "run_started":
      return { log: "Workflow started." };
    case "step_started":
      return {
        log: attempt > 1 ? `Step ${name}: attempt ${attempt}…` : `Step ${name}…`,
        step: { nodeId, status: "running", attempt },
      };
    case "step_succeeded":
      return { log: `Step ${name} succeeded.`, step: { nodeId, status: "succeeded", attempt } };
    case "step_failed": {
      const message = errorText(event.error);
      return { log: `Step ${name} failed: ${message}`, step: { nodeId, status: "failed", attempt, message } };
    }
    case "step_retry_scheduled": {
      const next = typeof event.next_attempt === "number" ? event.next_attempt : attempt + 1;
      const by = typeof event.triggered_by === "string" ? names[event.triggered_by] ?? event.triggered_by : name;
      return {
        log: by === name ? `Retrying ${name} (attempt ${next}).` : `${by} failed; retrying ${name} (attempt ${next}).`,
        step: { nodeId, status: "retry", attempt: next },
      };
    }
    case "permission_requested":
      return { log: `Step ${name} is waiting for a permission.`, step: { nodeId, status: "waiting", attempt } };
    case "permission_resolved":
      return { step: { nodeId, status: "running", attempt } };
    case "transition_selected": {
      const to = typeof event.to === "string" ? names[event.to] ?? event.to : "";
      return event.condition === "on_failure" ? { log: `Following the failure path to ${to}.` } : {};
    }
    case "run_paused":
      return { log: "Workflow paused." };
    case "run_resumed":
      return { log: "Workflow resumed." };
    default:
      // run_completed/failed/cancelled are reported with the final state;
      // step_ready and budget_updated carry nothing to show.
      return {};
  }
}

/** The outcome of a finished run, from its final `OrchestrationRunState`. */
export function workflowOutcome(state: unknown): WorkflowOutcome {
  const run = (state ?? {}) as { status?: unknown; final_output?: unknown; error?: unknown };
  if (run.status === "completed") return { status: "completed", output: run.final_output ?? null };
  if (run.status === "cancelled") return { status: "cancelled" };
  const error = (run.error ?? {}) as { code?: unknown };
  return {
    status: "failed",
    code: typeof error.code === "string" ? error.code : "WORKFLOW_FAILED",
    message: run.error ? errorText(run.error) : `The workflow ended as ${String(run.status ?? "unknown")}.`,
  };
}

/** A workflow's output as chat text: its summary when it has one, else JSON. */
export function formatWorkflowOutput(output: unknown): string {
  if (typeof output === "string") return output;
  if (output && typeof output === "object") {
    const summary = (output as { summary?: unknown }).summary;
    const json = "```json\n" + JSON.stringify(output, null, 2) + "\n```";
    return typeof summary === "string" && summary ? `${summary}\n\n${json}` : json;
  }
  return output === null || output === undefined ? "The workflow completed without output." : String(output);
}

/**
 * The input a workflow receives for a chat message: a JSON object message
 * is passed as-is (for workflows with their own input schema); anything
 * else becomes `{ request, attachments }`, the default workflow's input.
 */
export function workflowInputFor(message: string): unknown {
  const trimmed = message.trim();
  if (trimmed.startsWith("{")) {
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed;
    } catch {
      // Not JSON: a request that happens to start with a brace.
    }
  }
  return { request: message, attachments: [] };
}
