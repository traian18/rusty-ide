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

export interface FailedWorkflowCheckpoint {
  status: "failed";
  definition_id: string;
  failed_step: string;
  [key: string]: unknown;
}

/** Native code validates the full state and exact definition hash before retry. */
export function readWorkflowCheckpoint(value: unknown): FailedWorkflowCheckpoint | undefined {
  if (!value || typeof value !== "object") return undefined;
  const state = value as Record<string, unknown>;
  return state.status === "failed" && typeof state.definition_id === "string" && typeof state.failed_step === "string"
    ? state as FailedWorkflowCheckpoint : undefined;
}

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

interface GraphNode {
  id?: unknown;
  type?: unknown;
  name?: unknown;
}

interface GraphEdge {
  source?: unknown;
  target?: unknown;
  condition?: unknown;
}

const nodesOf = (definition: unknown): GraphNode[] => {
  const nodes = (definition as { nodes?: unknown } | null)?.nodes;
  return Array.isArray(nodes) ? (nodes as GraphNode[]) : [];
};

const edgesOf = (definition: unknown): GraphEdge[] => {
  const edges = (definition as { edges?: unknown } | null)?.edges;
  return Array.isArray(edges) ? (edges as GraphEdge[]) : [];
};

/** Node ids in the order a run reaches them: the input, then along the
 * success edges. Nodes no edge reaches follow in document order. */
export function stepOrder(definition: unknown): string[] {
  const nodes = nodesOf(definition).filter((node): node is GraphNode & { id: string } => typeof node.id === "string");
  const edges = edgesOf(definition).filter((edge) => edge.condition === "on_success" || edge.condition === undefined);
  const order: string[] = [];
  const queue = nodes.filter((node) => node.type === "input").map((node) => node.id);
  while (queue.length > 0) {
    const id = queue.shift()!;
    if (order.includes(id)) continue;
    order.push(id);
    for (const edge of edges) if (edge.source === id && typeof edge.target === "string") queue.push(edge.target);
  }
  for (const node of nodes) if (!order.includes(node.id)) order.push(node.id);
  return order;
}

/** The agent steps still to run after `nodeId`, in order. */
export function remainingAgentSteps(definition: unknown, nodeId: string): string[] {
  const order = stepOrder(definition);
  const types = new Map(nodesOf(definition).map((node) => [String(node.id), String(node.type)]));
  const after = order.indexOf(nodeId);
  return after < 0 ? [] : order.slice(after + 1).filter((id) => types.get(id) === "agent");
}

export interface FinishedStep {
  id: string;
  name: string;
  output: string;
}

/** The agent steps a run state shows as succeeded, with their outputs as
 * text, in the order they ran. */
export function finishedAgentSteps(definition: unknown, state: unknown): FinishedStep[] {
  const steps = ((state ?? {}) as { steps?: Record<string, { status?: unknown; output?: unknown }> }).steps ?? {};
  const names = stepNames(definition);
  const types = new Map(nodesOf(definition).map((node) => [String(node.id), String(node.type)]));
  return stepOrder(definition)
    .filter((id) => types.get(id) === "agent" && steps[id]?.status === "succeeded")
    .map((id) => {
      const output = steps[id]?.output;
      return { id, name: names[id] ?? id, output: typeof output === "string" ? output : output === undefined || output === null ? "" : JSON.stringify(output) };
    });
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

/** Whether any step of `definition` reads `/context` from the run input. */
export function workflowUsesContext(definition: unknown): boolean {
  const nodes = (definition as { nodes?: unknown } | null)?.nodes;
  if (!Array.isArray(nodes)) return false;
  return nodes.some((node) => {
    const bindings = (node as { input_bindings?: unknown } | null)?.input_bindings;
    return Array.isArray(bindings) && bindings.some((binding) => {
      const source = (binding as { source?: { type?: unknown; pointer?: unknown } } | null)?.source;
      return source?.type === "run_input" && source.pointer === "/context";
    });
  });
}

/** Characters of an earlier result a workflow is given as context. */
export const MAX_WORKFLOW_CONTEXT_CHARS = 24_000;

/** Chat rows that are run bookkeeping, not results (step markers, failures,
 * the per-step AUTO line). */
const NOT_A_RESULT = /^(\*\*[▶✗]|↳ AUTO|↪ AUTO|Error:|Model selection error:)/;

/**
 * What the last run left in the chat, for the next workflow to build on: the
 * most recent assistant result. This is how a long job is steered between
 * stages: read the findings, amend them in your next message, then run the
 * next stage, which receives the findings as context.
 */
export function priorWorkflowContext(messages: ReadonlyArray<{ role: string; content: string }>): string {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const { role, content } = messages[index];
    const text = content.trim();
    if (role !== "assistant" || !text || NOT_A_RESULT.test(text)) continue;
    return text.length > MAX_WORKFLOW_CONTEXT_CHARS
      ? `${text.slice(0, MAX_WORKFLOW_CONTEXT_CHARS)}\n[… ${text.length - MAX_WORKFLOW_CONTEXT_CHARS} more characters omitted]`
      : text;
  }
  return "";
}

/**
 * The input a workflow receives for a chat message: a JSON object message
 * is passed as-is only when explicitly enabled for a legacy JSON workflow; anything
 * else becomes `{ request, attachments }`, the default workflow's input.
 * `context` (an earlier result, "" when there is none) is added for a workflow
 * whose steps read it.
 */
export function workflowInputFor(message: string, parseJson = false, context?: string): unknown {
  const trimmed = message.trim();
  if (parseJson && trimmed.startsWith("{")) {
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return context === undefined ? parsed : { context, ...(parsed as object) };
      }
    } catch {
      // Not JSON: a request that happens to start with a brace.
    }
  }
  return { request: message, attachments: [], ...(context === undefined ? {} : { context }) };
}
