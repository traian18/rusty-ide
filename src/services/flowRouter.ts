/**
 * flowRouter.ts -- choosing a workflow with the JEV Decisions API.
 *
 * Two questions, one mechanism. Before a run: which workflow (or none) fits
 * the user's message? At a step boundary: should the running workflow carry on,
 * or does what it found mean another workflow is the right one?
 *
 * JEV rates a `choice` question over the candidate flows, each described by
 * when it applies; the answer's confidence decides what happens next. The two
 * questions fail differently on purpose. A message that cannot be routed is put
 * to the user; a boundary that cannot be decided simply continues, because
 * holding a running workflow hostage to an uncertain guess costs more than
 * finishing the plan it already has. Switching to a workflow that edits files
 * is always put to the user first.
 */

import { decideBody, parseDecideAnswer, NEED_MORE_CONTEXT, type DecideRequest, type DecideVerdict } from "../harness/core/definitions/decideTool";
import { withTimeout } from "../harness/core/definitions/stepModelSelection";
import { JEV_CONFIDENCE_THRESHOLD, postJevDecision, type JevDecisionResponse } from "./intelligentModelSelector";

export const SINGLE_AGENT_ID = "single_agent";
export const CONTINUE_ID = "continue";

/** A slow decision service must not hold a message or a paused run for long. */
export const FLOW_ROUTING_TIMEOUT_MS = 10_000;

const MAX_MESSAGE_CHARS = 4_000;
const MAX_RESULT_CHARS = 2_000;
const MAX_STEP_CHARS = 3_000;
const MAX_STEPS_CHARS = 9_000;
/** The most options put to the user when the router cannot decide. */
export const MAX_ASKED_OPTIONS = 4;

export interface FlowOption {
  /** Short id, e.g. `investigate` or `single_agent`. */
  id: string;
  /** What the user sees for it. */
  name: string;
  /** When it is the right choice. */
  criterion: string;
  /** Whether choosing it means files get changed. */
  edits: boolean;
}

export interface RankedFlow {
  id: string;
  probability: number;
}

/** What to do with a message. */
export type MessageRoute =
  | { type: "run"; id: string; confidence: number }
  | { type: "confirm"; id: string; confidence: number; ranked: RankedFlow[] }
  | { type: "ask"; ranked: RankedFlow[]; confidence: number }
  | { type: "unavailable"; reason: string };

/** What to do at a step boundary. */
export type BoundaryRoute =
  | { type: "continue"; reason?: string }
  | { type: "switch"; id: string; confidence: number }
  | { type: "confirm"; id: string; confidence: number };

/** One router exchange with JEV, reported whether or not it worked. */
export interface FlowDecisionTrace {
  id: string;
  kind: "message" | "boundary";
  jevModelId: string;
  query: string;
  startedAt: string;
  finishedAt: string;
  request: unknown;
  httpStatus?: number;
  response?: unknown;
  outcome: "decided" | "failed";
  choice?: string;
  confidence?: number;
  ranked?: RankedFlow[];
  cost?: number;
  error?: string;
}

export interface FlowRouterDeps {
  apiKey: string;
  jevModelId: string;
  proceedConfidence?: number;
  signal?: AbortSignal;
  post?: typeof postJevDecision;
  onTrace?: (trace: FlowDecisionTrace) => void;
}

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}… [${text.length - max} more characters]` : text;
}

/** JEV names its options by key; hyphens in workflow ids are not worth risking. */
const toKey = (id: string) => id.replace(/-/g, "_");

interface Exchange {
  verdict?: DecideVerdict;
  ranked: RankedFlow[];
  error?: string;
}

async function ask(
  kind: FlowDecisionTrace["kind"],
  deps: FlowRouterDeps,
  question: string,
  state: string,
  options: FlowOption[],
): Promise<Exchange> {
  const keys = new Map(options.map((option) => [toKey(option.id), option.id]));
  const request: DecideRequest = {
    question,
    kind: "choice",
    options: options.map((option) => ({ id: toKey(option.id), criterion: option.criterion })),
    facts: [],
    constraints: [],
    tried: [],
  };
  const body = decideBody(deps.jevModelId, state, request);
  const trace: FlowDecisionTrace = {
    id: `jev_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    kind,
    jevModelId: deps.jevModelId,
    query: state,
    startedAt: new Date().toISOString(),
    finishedAt: "",
    request: body,
    outcome: "failed",
  };
  const guard = withTimeout(deps.signal, FLOW_ROUTING_TIMEOUT_MS);
  try {
    let response: JevDecisionResponse<{ answers?: { decision?: unknown }; usage?: { cost?: number } }>;
    try {
      response = await (deps.post ?? postJevDecision)(deps.apiKey, body, guard.signal);
    } catch (error) {
      trace.error = `Flow routing could not be reached: ${error instanceof Error ? error.message : String(error)}`;
      return { ranked: [], error: trace.error };
    }
    trace.httpStatus = response.status;
    trace.response = response.result ?? response.text;
    if (!response.ok || !response.result) {
      trace.error = `Flow routing failed (${response.status}).`;
      return { ranked: [], error: trace.error };
    }
    if (typeof response.result.usage?.cost === "number") trace.cost = response.result.usage.cost;
    const verdict = parseDecideAnswer(request, response.result.answers?.decision as never, deps.proceedConfidence ?? JEV_CONFIDENCE_THRESHOLD);
    if (!verdict) {
      trace.error = "Flow routing returned an invalid answer.";
      return { ranked: [], error: trace.error };
    }
    const ranked = verdict.ranked
      .filter((entry) => entry.id !== NEED_MORE_CONTEXT)
      .map((entry) => ({ id: keys.get(entry.id) ?? entry.id, probability: entry.probability }));
    trace.outcome = "decided";
    trace.choice = verdict.choice === NEED_MORE_CONTEXT ? NEED_MORE_CONTEXT : (keys.get(verdict.choice) ?? verdict.choice);
    trace.confidence = verdict.confidence;
    trace.ranked = ranked;
    return { verdict, ranked };
  } finally {
    guard.clear();
    trace.finishedAt = new Date().toISOString();
    try {
      deps.onTrace?.(trace);
    } catch (error) {
      console.warn("Flow routing trace could not be recorded:", error);
    }
  }
}

/** The id JEV chose, when it chose one decisively (not `need_more_context`). */
function decisive(verdict: DecideVerdict | undefined, options: FlowOption[]): FlowOption | undefined {
  if (!verdict?.decisive) return undefined;
  return options.find((option) => toKey(option.id) === verdict.choice);
}

// ---- before a run ---------------------------------------------------------------

export interface MessageRouteInput {
  message: string;
  /** The last result in the conversation, if any. */
  lastResult?: string;
  /** The workflow the previous run followed, and how it ended. */
  lastRun?: { name: string; status: string };
  options: FlowOption[];
}

export function buildMessageState({ message, lastResult, lastRun }: Pick<MessageRouteInput, "message" | "lastResult" | "lastRun">): string {
  return [
    "A user is chatting with an AI coding assistant inside a code editor. The assistant can follow one of several workflows or answer directly. Decide which option fits the user's latest message best.",
    "Latest message:",
    clip(message.trim(), MAX_MESSAGE_CHARS),
    "",
    ...(lastResult
      ? [
        "The last result in the conversation (excerpt), which the message may be reacting to:",
        clip(lastResult.trim(), MAX_RESULT_CHARS),
        ...(lastRun ? [`It came from the workflow "${lastRun.name}", which ${lastRun.status}.`] : []),
      ]
      : ["There is no earlier result in this conversation."]),
  ].join("\n");
}

/**
 * Which workflow should run for a message. A decisive pick that cannot change
 * files runs straight away; one that can asks first; anything else is put to
 * the user with the likeliest options.
 */
export async function routeMessage(input: MessageRouteInput, deps: FlowRouterDeps): Promise<MessageRoute> {
  const state = buildMessageState(input);
  const { verdict, ranked, error } = await ask("message", deps, "Which option fits the user's latest message best?", state, input.options);
  if (error || !verdict) return { type: "unavailable", reason: error ?? "No answer." };
  const chosen = decisive(verdict, input.options);
  if (chosen) {
    return chosen.edits
      ? { type: "confirm", id: chosen.id, confidence: verdict.confidence, ranked }
      : { type: "run", id: chosen.id, confidence: verdict.confidence };
  }
  return { type: "ask", ranked: ranked.slice(0, MAX_ASKED_OPTIONS), confidence: verdict.confidence };
}

// ---- at a step boundary -------------------------------------------------------------

export interface FinishedStep {
  name: string;
  output: string;
}

export interface BoundaryRouteInput {
  request: string;
  workflowName: string;
  /** The step that just finished. */
  step: string;
  finished: FinishedStep[];
  remaining: string[];
  targets: FlowOption[];
}

const CONTINUE_CRITERION =
  "The findings so far fit what was asked and the remaining steps are the right next work, so the workflow should carry on as planned.";

export function buildBoundaryState(input: BoundaryRouteInput): string {
  const steps: string[] = [];
  let used = 0;
  // The latest steps matter most: keep them, and drop the oldest when space runs out.
  for (const step of [...input.finished].reverse()) {
    const block = `### ${step.name}\n${clip(step.output.trim() || "(no output)", MAX_STEP_CHARS)}`;
    if (used + block.length > MAX_STEPS_CHARS && steps.length > 0) {
      steps.push(`[${input.finished.length - steps.length} earlier step(s) omitted]`);
      break;
    }
    steps.push(block);
    used += block.length;
  }
  return [
    `An automated workflow ("${input.workflowName}") is running for a user's request inside a code editor. It paused after the step "${input.step}". Decide whether it should carry on as planned or hand over to a different workflow.`,
    "Hand over only when what the steps found, not just the wording of the request, shows that another option now applies.",
    "User request:",
    clip(input.request.trim(), MAX_MESSAGE_CHARS),
    "",
    "Steps finished so far (latest first):",
    steps.join("\n\n"),
    "",
    input.remaining.length ? `Steps still to run: ${input.remaining.join(", ")}.` : "No steps remain.",
  ].join("\n");
}

/**
 * Whether the running workflow carries on. Anything short of a decisive pick of
 * another workflow continues; a decisive pick of one that can change files asks.
 */
export async function routeBoundary(input: BoundaryRouteInput, deps: FlowRouterDeps): Promise<BoundaryRoute> {
  const options: FlowOption[] = [
    { id: CONTINUE_ID, name: "Continue", criterion: CONTINUE_CRITERION, edits: false },
    ...input.targets,
  ];
  const { verdict, error } = await ask(
    "boundary",
    deps,
    "Should the workflow carry on as planned, or hand over to another workflow?",
    buildBoundaryState(input),
    options,
  );
  if (error || !verdict) return { type: "continue", reason: error };
  const chosen = decisive(verdict, options);
  if (!chosen || chosen.id === CONTINUE_ID) return { type: "continue" };
  return chosen.edits
    ? { type: "confirm", id: chosen.id, confidence: verdict.confidence }
    : { type: "switch", id: chosen.id, confidence: verdict.confidence };
}
