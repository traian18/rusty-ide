/**
 * workflowRun.ts — reading a rusty-core workflow run as it streams in.
 *
 * A workflow run (a `.rusty/workflows/*.json` orchestration started with
 * `harness_start_workflow`) reports committed orchestration events and a
 * final run state over the session's bridge. These helpers turn them into
 * what a capability run shows: log lines, per-step progress, and the
 * outcome. Pure, so the mapping is testable without a session.
 */

import { markdownText } from "./markdownText";

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
      return { id, name: names[id] ?? id, output: output === undefined || output === null ? "" : markdownText(output) };
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
    case "task_progress":
      return { log: `${name}: ${event.completed} of ${event.total} tasks inspected and checkpointed.` };
    case "step_started":
      return {
        log: attempt > 1 ? `Step ${name}: attempt ${attempt}…` : `Step ${name}…`,
        step: { nodeId, status: "running", attempt },
      };
    case "step_succeeded":
      return { log: `Step ${name} succeeded.`, step: { nodeId, status: "succeeded", attempt } };
    case "step_failed": {
      const error = event.error as { code?: unknown } | undefined;
      const message = error?.code === "verification_failed" ? "Verification found unmet criteria." : errorText(event.error);
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

/** A workflow's output as chat text: its summary first when it has one, then
 * the rest as Markdown sections. Never JSON. */
export function formatWorkflowOutput(output: unknown): string {
  if (typeof output === "string") return output;
  if (output && typeof output === "object" && !Array.isArray(output)) {
    const { summary, ...rest } = output as { summary?: unknown };
    const details = markdownText(rest);
    return typeof summary === "string" && summary ? (details ? `${summary}\n\n${details}` : summary) : details;
  }
  return output === null || output === undefined ? "The workflow completed without output." : String(output);
}

/** A failed acceptance gate still has the reviewer's completed result. Show
 * that result as the final verdict when automatic repair retries run out. */
export function failedVerificationReport(definition: unknown, state: unknown): string | undefined {
  const run = state as { failed_step?: unknown; error?: { code?: unknown; message?: unknown }; steps?: Record<string, { output?: unknown }> } | null;
  if (run?.error?.code !== "verification_failed" || typeof run.failed_step !== "string") return undefined;
  const gate = nodesOf(definition).find((node) => node.id === run.failed_step) as (GraphNode & {
    type?: unknown;
    config?: { retry_target?: unknown };
    input_bindings?: Array<{ target?: unknown; source?: { type?: unknown; node_id?: unknown } }>;
  }) | undefined;
  if (gate?.type !== "verify" || typeof gate.config?.retry_target !== "string") return undefined;
  const sources = gate.input_bindings?.filter((binding) => binding.source?.type === "node_output") ?? [];
  const reviewed = sources.find((binding) => {
    const output = typeof binding.source?.node_id === "string" ? run.steps?.[binding.source.node_id]?.output : undefined;
    return output && typeof output === "object" && !Array.isArray(output)
      && ["verdict", "status", "criteria"].some((field) => field in output);
  });
  const reviewer = (sources.find((binding) => binding.target === "check") ?? reviewed ?? sources.at(-1))?.source;
  const output = reviewer?.type === "node_output" && typeof reviewer.node_id === "string"
    ? run.steps?.[reviewer.node_id]?.output : undefined;
  const result = output as {
    verdict?: unknown;
    status?: unknown;
    summary?: unknown;
    criteria?: unknown;
  } | undefined;
  const criteria = Array.isArray(result?.criteria) ? result.criteria.filter((item) => item && typeof item === "object") : [];
  const lines = [
    "## Verification did not pass",
    "Automatic repair attempts are complete. The last review found work still needed.",
    `**Verdict:** ${typeof result?.verdict === "string" ? result.verdict : typeof result?.status === "string" ? result.status : "failed"}`,
  ];
  if (typeof result?.summary === "string" && result.summary.trim()) lines.push(result.summary.trim());
  else if (output !== undefined) lines.push(formatWorkflowOutput(output));
  else if (typeof run.error?.message === "string") lines.push(run.error.message);
  if (criteria.length) lines.push(markdownText({ criteria }));
  return lines.join("\n\n");
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

/** The line the chat appends to a result that was saved as a report (see
 * services/workflowReport.ts). It belongs to the chat, not to the result, so a
 * later run must not be handed it as part of what was found. */
const SAVED_REPORT_NOTE = /\n\n_(?:Result saved to|The result could not be saved to) [^\n]*_\s*$/;

/**
 * What the last run left in the chat, for the next workflow to build on: the
 * most recent assistant result. This is how a long job is steered between
 * stages: read the findings, amend them in your next message, then run the
 * next stage, which receives the findings as context.
 */
export function priorWorkflowContext(
  messages: ReadonlyArray<{ role: string; content: string }>,
  maxChars = MAX_WORKFLOW_CONTEXT_CHARS,
): string {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const { role, content } = messages[index];
    const text = content.replace(SAVED_REPORT_NOTE, "").trim();
    if (role !== "assistant" || !text || NOT_A_RESULT.test(text)) continue;
    return text.length > maxChars
      ? `${text.slice(0, maxChars)}\n[… ${text.length - maxChars} more characters omitted]`
      : text;
  }
  return "";
}

/** A reply this short is a remark on an earlier result, not a result to build on. */
const SHORT_REPLY_CHARS = 600;
const MAX_CONTEXT_RESULTS = 3;

/**
 * The results a next run should build on. Usually that is the last result. But
 * when the last reply is only a short remark (an answer to a quick question
 * between an analysis and "now implement it"), the analysis is what the next
 * run needs, so the nearest substantial result comes with it, oldest first.
 */
export function conversationResults(
  messages: ReadonlyArray<{ role: string; content: string }>,
  maxChars = MAX_WORKFLOW_CONTEXT_CHARS,
): string {
  const found: string[] = [];
  for (let index = messages.length - 1; index >= 0 && found.length < MAX_CONTEXT_RESULTS; index -= 1) {
    const { role, content } = messages[index];
    const text = content.replace(SAVED_REPORT_NOTE, "").trim();
    if (role !== "assistant" || !text || NOT_A_RESULT.test(text)) continue;
    found.push(text);
    if (text.length >= SHORT_REPLY_CHARS) break;
  }
  if (found.length <= 1) return priorWorkflowContext(messages, maxChars);
  const [latest, ...earlier] = found;
  // The latest remark is short; what it remarks on gets the rest of the room.
  const room = Math.max(0, maxChars - latest.length - 40);
  const clip = (text: string, limit: number) => (text.length > limit ? `${text.slice(0, limit)}\n[… ${text.length - limit} more characters omitted]` : text);
  const blocks = earlier.reverse().map((text, index) => `${index === 0 ? "Earlier result" : "Next reply"}:\n${clip(text, room)}`);
  return [...blocks, `Latest reply:\n${clip(latest, maxChars)}`].join("\n\n");
}

/** How much of the conversation a workflow without a `/context` input is shown. */
export const MAX_FOLDED_RESULT_CHARS = 12_000;
const MAX_FOLDED_REQUESTS = 4;
const MAX_FOLDED_REQUEST_CHARS = 800;

/**
 * Puts the conversation so far behind a request, for a workflow whose steps
 * only read the request. Each run is a fresh session, so without this a
 * follow-up ("now fix what you found") reaches the workflow as a bare
 * sentence and its first step starts from nothing. The new request leads;
 * the earlier requests and the last result follow, marked as background.
 * `earlierWork` stands in for the last result when a run handed over to this
 * workflow with work already done. A first message is returned untouched.
 */
export function withConversation(
  request: string,
  messages: ReadonlyArray<{ role: string; content: string }>,
  earlierWork?: string,
): string {
  const earlierRequests = messages
    .filter((message) => message.role === "user" && message.content.trim())
    .slice(-MAX_FOLDED_REQUESTS)
    .map(({ content }) => {
      const text = content.trim();
      return `- ${text.length > MAX_FOLDED_REQUEST_CHARS ? `${text.slice(0, MAX_FOLDED_REQUEST_CHARS)}…` : text}`;
    });
  const lastResult = earlierWork?.trim() || conversationResults(messages, MAX_FOLDED_RESULT_CHARS);
  if (earlierRequests.length === 0 && !lastResult) return request;
  return [
    request,
    "",
    "---",
    "Background from earlier in this conversation. The request above is what to do now; use the background only to understand it.",
    ...(earlierRequests.length > 0 ? ["", "Earlier requests:", ...earlierRequests] : []),
    ...(lastResult ? ["", "Result of the last run:", lastResult] : []),
  ].join("\n");
}

/**
 * The input a workflow receives for a chat message: a JSON object message
 * is passed as-is only when explicitly enabled for a legacy JSON workflow; anything
 * else becomes `{ request, attachments }`, the default workflow's input.
 * `context` (an earlier result, "" when there is none) is added for a workflow
 * whose steps read it.
 */
export function workflowInputFor(message: string, parseJson = false, context?: string, conversation?: ReadonlyArray<{ role: string; content: string }>): unknown {
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
  return { request: message, attachments: [], ...(context === undefined ? {} : { context }), ...(conversation ? { conversation: conversation.filter(m => m.role === "user" || (m.role === "assistant" && !NOT_A_RESULT.test(m.content))).map(({role, content}) => ({role, content})) } : {}) };
}
