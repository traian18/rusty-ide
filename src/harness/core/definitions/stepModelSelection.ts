/**
 * stepModelSelection.ts -- AUTO model choice for each step of a workflow run.
 *
 * A workflow's steps differ a great deal in difficulty: Research and Verify
 * read and report, Architect and Debug reason hard, Build edits many files.
 * Rating the whole request once and running every step on that model wastes
 * the strongest model on easy steps (or starves a hard one). So when a run is
 * AUTO, JEV rates each agent step on its own, right before the step's first
 * model turn, and the step runs on the matching level's model.
 *
 * Every model turn is answered by the IDE (`handleHostExecuteCall`), so the
 * choice is applied by rewriting `params.model` on the step's requests: the
 * turn waits for JEV, and nothing can race the first request. A step is
 * identified by its run id, which is shared by all of its model turns.
 * Anything that goes wrong keeps the run's base model: choosing is an
 * optimization and must never stop a step.
 */

import { AUTO_LEVELS, type AutoLevel } from "../../../store/intelligentModelSelectionTypes";
import {
  AUTO_LEVEL_CRITERIA,
  AUTO_LEVEL_LABELS,
  postJevDecision,
  resolveAutoLevel,
  type JevDecisionResponse,
  type JevDecisionTrace,
  type JevScoreAnswer,
} from "../../../services/intelligentModelSelector";
import type { CustomProvider } from "../../../store/types";
import type { CapabilityEvent } from "../../contract";
import type { StepModelRunConfig } from "../decideToolConfig";
import type { ExecutionRequest } from "../engine/ExecutionProtocol";
import { recordAppliedModel } from "../appliedModels";
import { mapProviderToIntegration } from "../providerMapping";
import { inPlaceLevelTargets, type StepUpTarget } from "./decideStepUp";

/** JEV shares a 32k-token window between state and rubric. The head of a step
 * prompt says what the step does; the tail holds the latest hand-off. */
const MAX_PROMPT_CHARS = 16_000;
/** A slow decision service must not hold a step's first model turn for long. */
export const STEP_SELECTION_TIMEOUT_MS = 12_000;

const STEP_LEVEL_INSTRUCTIONS =
  "How capable must the AI model be to carry out this workflow step well? Judge the step's own work: reading code and summarizing, verifying a result, or writing documentation needs less than designing a system, diagnosing a subtle fault, or editing many files at once. Choose the lowest level that is enough: more capable models are slower and more expensive, so a stronger model than needed is a worse answer.";

export interface StepModelChoice {
  /** The level whose model the step runs on. */
  level: AutoLevel;
  /** JEV's most likely level, before any step-up or availability fallback. */
  jevLevel: AutoLevel;
  escalated: boolean;
  confidence: number;
  target: StepUpTarget;
  cost?: number;
}

/** What a workflow step's model turn asks the model: the step's own prompt
 * (instructions plus the workflow input it was handed). */
export function stepPromptText(request: Pick<ExecutionRequest, "messages">): string {
  const texts = request.messages
    .filter((message) => message.role === "User")
    .flatMap((message) => (Array.isArray(message.content) ? (message.content as unknown[]) : []))
    .map((block) => (block as { Text?: { text?: unknown } } | null)?.Text?.text)
    .filter((text): text is string => typeof text === "string");
  return texts.find((text) => text.includes("<workflow_input>")) ?? texts[0] ?? "";
}

function clip(text: string): string {
  if (text.length <= MAX_PROMPT_CHARS) return text;
  const half = MAX_PROMPT_CHARS / 2;
  return `${text.slice(0, half)}\n[… ${text.length - MAX_PROMPT_CHARS} characters omitted …]\n${text.slice(-half)}`;
}

function buildStepState(prompt: string, step?: string): string {
  return [
    "An AI agent inside a code editor is about to carry out one step of an automated multi-step workflow. It can read and edit the user's project files and run tools.",
    ...(step ? [`Step: ${step}`] : []),
    "Judge how demanding this step is on its own, not the whole workflow. The step's instructions, the user's request and the hand-offs from earlier steps follow.",
    "Step prompt:",
    clip(prompt),
  ].join("\n");
}

/** The level's own target, else the nearest more capable one, else the nearest
 * less capable one: under-powering a step costs more than over-paying. */
export function pickTarget(
  wanted: AutoLevel,
  targets: Partial<Record<AutoLevel, StepUpTarget>>,
): StepUpTarget | undefined {
  const index = AUTO_LEVELS.indexOf(wanted);
  const order = [wanted, ...AUTO_LEVELS.slice(index + 1), ...AUTO_LEVELS.slice(0, index).reverse()];
  for (const level of order) {
    const target = targets[level];
    if (target) return target;
  }
  return undefined;
}

/** `signal` aborted by the caller or after `ms`, whichever comes first. */
export function withTimeout(signal: AbortSignal | undefined, ms: number): { signal: AbortSignal; clear: () => void } {
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (signal?.aborted) abort();
  signal?.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(abort, ms);
  return {
    signal: controller.signal,
    clear: () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
    },
  };
}

export interface StepModelSelectionDeps {
  config: StepModelRunConfig;
  provider: CustomProvider | undefined;
  /** The model the run (and so every step) starts on. */
  baseModel: string;
  request: Pick<ExecutionRequest, "messages">;
  /** The step's display name, for the decision record. */
  step?: string;
  signal?: AbortSignal;
  post?: typeof postJevDecision;
  onTrace?: (trace: JevDecisionTrace) => void;
}

/**
 * Asks JEV how capable a model the step needs and maps the answer to a model
 * the session can use in place. `undefined` means "keep the base model": there
 * is nothing to choose between, or the decision failed.
 */
export async function selectStepModel(deps: StepModelSelectionDeps): Promise<StepModelChoice | undefined> {
  const { config, provider, baseModel, request, step, onTrace } = deps;
  const post = deps.post ?? postJevDecision;
  const targets = inPlaceLevelTargets(config.levels, provider, baseModel);
  // With fewer than two models to choose between, rating the step changes nothing.
  if (new Set(Object.values(targets).map((target) => target.params.model)).size < 2) return undefined;

  const prompt = stepPromptText(request);
  const body = {
    model: config.jevModelId,
    state: buildStepState(prompt, step),
    questions: {
      level: {
        type: "score",
        instructions: STEP_LEVEL_INSTRUCTIONS,
        criteria: AUTO_LEVELS.map((level) => `${AUTO_LEVEL_LABELS[level]}: ${AUTO_LEVEL_CRITERIA[level]}`),
      },
    },
  };
  const trace: JevDecisionTrace = {
    id: `jev_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    jevModelId: config.jevModelId,
    query: prompt,
    startedAt: new Date().toISOString(),
    finishedAt: "",
    request: body,
    outcome: "failed",
  };
  const guard = withTimeout(deps.signal, STEP_SELECTION_TIMEOUT_MS);
  try {
    let response: JevDecisionResponse<{ answers?: { level?: JevScoreAnswer }; usage?: { cost?: number } }>;
    try {
      response = await post(config.apiKey, body, guard.signal);
    } catch (error) {
      trace.error = `Step model selection could not be reached: ${error instanceof Error ? error.message : String(error)}`;
      return undefined;
    }
    trace.httpStatus = response.status;
    trace.response = response.result ?? response.text;
    if (!response.ok || !response.result) {
      trace.error = `Step model selection failed (${response.status}).`;
      return undefined;
    }
    if (typeof response.result.usage?.cost === "number") trace.cost = response.result.usage.cost;

    const answer = response.result.answers?.level;
    const confidence = answer?.confidence;
    const probabilities: Partial<Record<AutoLevel, number>> = {};
    AUTO_LEVELS.forEach((level, index) => {
      const probability = answer?.probabilities?.[String(index)];
      if (typeof probability === "number") probabilities[level] = probability;
    });
    if (answer?.type !== "score" || typeof confidence !== "number" || Object.keys(probabilities).length === 0) {
      trace.error = "Step model selection returned an invalid answer.";
      return undefined;
    }
    trace.confidence = confidence;
    trace.probabilities = probabilities;

    const { level, jevLevel, escalated } = resolveAutoLevel(probabilities, confidence);
    const target = pickTarget(level, targets);
    if (!target) {
      trace.error = "No model is available in place for this step's level.";
      return undefined;
    }
    trace.jevLevel = jevLevel;
    trace.level = level;
    trace.escalated = escalated;
    trace.selectedModel = `${provider?.id ?? ""}:${target.model}`;
    trace.outcome = "selected";
    return { level: target.level, jevLevel, escalated, confidence, target, cost: trace.cost };
  } finally {
    guard.clear();
    trace.finishedAt = new Date().toISOString();
    try {
      onTrace?.(trace);
    } catch (error) {
      console.warn("Step model selection trace could not be recorded:", error);
    }
  }
}

/** A copy of `request` that runs on `target`. */
export function withStepModel(request: ExecutionRequest, target: StepUpTarget): ExecutionRequest {
  const { reasoning_effort: _inherited, ...params } = request.params ?? {};
  return { ...request, params: { ...params, ...target.params } };
}

export interface PrepareStepRequestDeps extends Omit<StepModelSelectionDeps, "request"> {
  request: ExecutionRequest;
  /** The run's scratch space: remembers each step's choice. */
  scratch: Record<string, unknown>;
  onEvent: (event: CapabilityEvent<"agent_chat">) => void;
}

/**
 * Applies the step's model to one of its model requests. The first request of
 * a step (a new run id) waits for the choice; later ones reuse it. A request
 * whose model is no longer the run's base has been changed on purpose (a
 * mid-step `decide` step-up) and is left alone.
 */
export async function prepareStepRequest(deps: PrepareStepRequestDeps): Promise<ExecutionRequest> {
  const { request, scratch, onEvent, provider, baseModel } = deps;
  const selections = (scratch.stepModelSelections ??= new Map<string, Promise<StepModelChoice | undefined>>()) as Map<
    string,
    Promise<StepModelChoice | undefined>
  >;
  let selection = selections.get(request.run_id);
  if (!selection) {
    selection = selectStepModel(deps)
      .catch(() => undefined)
      .then((choice) => {
        if (choice) {
          const confidence = `${(choice.confidence * 100).toFixed(0)}% confidence`;
          const note = `${AUTO_LEVEL_LABELS[choice.level]} task${choice.escalated ? " (stepped up)" : ""} · ${choice.target.name} (${confidence})`;
          onEvent({ kind: "log", message: `AUTO${deps.step ? ` for ${deps.step}` : ""}: ${note}.` });
          onEvent({ kind: "progress", content: `↳ AUTO · ${note}` });
        }
        return choice;
      });
    selections.set(request.run_id, selection);
  }
  const choice = await selection;
  if (!choice) return request;
  const mapped = provider ? mapProviderToIntegration(provider, baseModel) : undefined;
  const baseParamsModel = mapped?.supported ? (mapped.model ?? baseModel) : baseModel;
  if (request.params?.model && request.params.model !== baseParamsModel) return request;
  // Core stamps a step's usage with the model it configured, which is still the
  // base model; accounting reads the model that really ran from here.
  recordAppliedModel(scratch, request.run_id, choice.target.params.model ?? choice.target.model);
  return withStepModel(request, choice.target);
}
