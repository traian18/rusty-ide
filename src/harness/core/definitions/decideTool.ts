import { NOOP_TOOL_EXECUTION_OBSERVER } from "../../contract/observability";
import type { CapabilityName, RunHost } from "../../contract";
import type { HostToolHandler, RunContext } from "../CoreHarness";
import { toolDecisionObserver, type ToolDecisionObserver } from "../toolDecisionObserver";
import type { HostToolSpec, SessionRecipe } from "../SessionRecipe";
import { DECIDE_TOOL_NAME, type DecideToolRunConfig } from "../decideToolConfig";
import { AUTO_LEVEL_LABELS, JEV_CONFIDENCE_THRESHOLD, postJevDecision, type JevDecisionResponse, type JevScoreAnswer } from "../../../services/intelligentModelSelector";
import type { AutoLevel } from "../../../store/intelligentModelSelectionTypes";
import type { CustomProvider } from "../../../store/types";
import { assessLevel, levelQuestion, stepUpTargets } from "./decideStepUp";
import { jevDecisionStats, type JevDecisionBand, type JevDecisionStats } from "../../../services/jevDecisionStats";

export const DECIDE_TOOL: HostToolSpec = {
  name: DECIDE_TOOL_NAME,
  description:
    "Get a decision whenever more than one reasonable path exists. Lay out the mutually exclusive options, each with one concrete criterion that would make it the right choice, plus the facts you gathered. Returns which option to take, or tells you to gather more evidence first.",
  input_schema: {
    type: "object",
    properties: {
      question: { type: "string", description: "The decision to make, as one question." },
      kind: {
        type: "string",
        enum: ["choice", "yes_no"],
        description: "'choice' to pick one of several options; 'yes_no' for a single yes/no question (use option ids 'yes' and 'no').",
      },
      options: {
        type: "array",
        minItems: 2,
        maxItems: 6,
        items: {
          type: "object",
          properties: {
            id: { type: "string", description: "Short snake_case identifier." },
            criterion: { type: "string", description: "When this option is the right one, stated concretely." },
          },
          required: ["id", "criterion"],
          additionalProperties: false,
        },
      },
      facts: {
        type: "array",
        items: { type: "string" },
        description: "Short evidence-based facts relevant to the decision, each with its source (file:line, command output, test result).",
      },
      constraints: { type: "array", items: { type: "string" }, description: "Requirements any option must respect." },
      tried: { type: "array", items: { type: "string" }, description: "What was already attempted, and how it turned out." },
    },
    required: ["question", "kind", "options", "facts"],
    additionalProperties: false,
  },
};

export const DECIDE_PROMPT_SECTION = `

Decisions:
- You gather facts and carry out the work; you do not choose between alternatives yourself. Whenever more than one reasonable path exists -- which approach or fix to use, how to recover from a failure, whether to go beyond what was asked, or whether the work is complete -- call '${DECIDE_TOOL_NAME}'.
- Gather the evidence first. Send short facts with their sources, not raw file contents.
- Make the options mutually exclusive, each with one concrete criterion that would make it right.
- When '${DECIDE_TOOL_NAME}' returns a decision, carry it out right away and do not revisit it unless new evidence contradicts it. When it asks for more evidence, gather exactly that and call it again.
- Do not call '${DECIDE_TOOL_NAME}' for mechanical steps: reading or searching files, running tests, or applying an edit that was already decided.
- Use 'ask_user_question' only for information only the user has; choices between options go through '${DECIDE_TOOL_NAME}'.`;

/** JEV's extra option for when the agent's facts don't support any real one. */
export const NEED_MORE_CONTEXT = "need_more_context";
const NEED_MORE_CONTEXT_CRITERION =
  "None of the options can be chosen yet: the facts above are not enough to tell which one is right, so more evidence is needed first.";

/** Calls on the same question before an undecided answer is escalated. */
export const MAX_DECIDE_ATTEMPTS = 3;
/** How many of the agent's next tool calls are linked to a decision it acted on. */
export const FOLLOW_UP_CALLS = 5;
const MAX_OPTIONS = 6;
/** JEV shares a 32k-token window between state and questions. */
const MAX_REQUEST_CHARS = 6_000;
const MAX_ITEM_CHARS = 1_000;
const MAX_LIST_CHARS = 8_000;
const MAX_CRITERION_CHARS = 600;
/** `host.askQuestion` shows at most this many suggestions. */
const MAX_USER_OPTIONS = 4;

export interface DecideOption {
  id: string;
  criterion: string;
}

export interface DecideRequest {
  question: string;
  kind: "choice" | "yes_no";
  options: DecideOption[];
  facts: string[];
  constraints: string[];
  tried: string[];
}

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}… [${text.length - max} more characters]` : text;
}

function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean)
    : [];
}

export function parseDecideRequest(args: unknown): { ok: true; request: DecideRequest } | { ok: false; error: string } {
  const parsed = (args && typeof args === "object" ? args : {}) as Record<string, unknown>;
  const question = typeof parsed.question === "string" ? parsed.question.trim() : "";
  if (!question) return { ok: false, error: "decide requires a question." };
  const kind = parsed.kind === "yes_no" ? "yes_no" : parsed.kind === "choice" || parsed.kind === undefined ? "choice" : undefined;
  if (!kind) return { ok: false, error: "decide kind must be 'choice' or 'yes_no'." };

  const rawOptions = Array.isArray(parsed.options) ? parsed.options : [];
  const options: DecideOption[] = [];
  for (const raw of rawOptions) {
    const option = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
    const id = typeof option.id === "string" ? option.id.trim() : "";
    const criterion = typeof option.criterion === "string" ? option.criterion.trim() : "";
    if (!id || !criterion) return { ok: false, error: "Every decide option needs a non-empty id and criterion." };
    if (id === NEED_MORE_CONTEXT) return { ok: false, error: `'${NEED_MORE_CONTEXT}' is reserved; describe only real options.` };
    if (options.some((existing) => existing.id === id)) return { ok: false, error: `Duplicate decide option id '${id}'.` };
    options.push({ id, criterion: clip(criterion, MAX_CRITERION_CHARS) });
  }
  if (kind === "yes_no") {
    const ids = options.map((option) => option.id).sort().join(",");
    if (options.length !== 2 || ids !== "no,yes") {
      return { ok: false, error: "A yes_no decision needs exactly two options, with ids 'yes' and 'no'." };
    }
  } else if (options.length < 2 || options.length > MAX_OPTIONS) {
    return { ok: false, error: `A choice decision needs 2-${MAX_OPTIONS} options.` };
  }

  const facts = strings(parsed.facts);
  if (facts.length === 0) return { ok: false, error: "decide requires at least one fact you gathered; collect evidence before asking for a decision." };
  return { ok: true, request: { question, kind, options, facts, constraints: strings(parsed.constraints), tried: strings(parsed.tried) } };
}

/** Earliest items win when a list does not fit: they are the agent's first-stated, most central facts. */
function describeList(items: string[]): string {
  const lines: string[] = [];
  let used = 0;
  for (const [index, item] of items.entries()) {
    const line = `- ${clip(item, MAX_ITEM_CHARS)}`;
    if (used + line.length > MAX_LIST_CHARS && lines.length > 0) {
      lines.push(`[${items.length - index} more omitted]`);
      break;
    }
    lines.push(line);
    used += line.length;
  }
  return lines.join("\n");
}

/** `recentSteps` is the agent's own track record (tool calls and their
 * outcomes, oldest first), when the run's tool observer has it. */
export function buildDecideState(request: DecideRequest, userRequest: string, recentSteps?: string): string {
  return [
    "An AI coding agent is working on a user's request inside a code editor. It gathered the facts below and needs a decision before it continues.",
    "User request:",
    clip(userRequest.trim() || "(not available)", MAX_REQUEST_CHARS),
    "",
    ...(recentSteps ? ["What the agent has done so far (oldest first):", recentSteps, ""] : []),
    "Facts the agent gathered:",
    describeList(request.facts),
    ...(request.constraints.length > 0 ? ["", "Constraints:", describeList(request.constraints)] : []),
    ...(request.tried.length > 0 ? ["", "Already tried:", describeList(request.tried)] : []),
  ].join("\n");
}

/** `withLevel` also asks AUTO's difficulty question about the remaining work. */
export function decideBody(jevModelId: string, state: string, request: DecideRequest, withLevel = false) {
  const criterion = (id: string) => request.options.find((option) => option.id === id)?.criterion ?? "";
  const decision = request.kind === "yes_no"
    ? { type: "noul", instructions: request.question, criteria: { true: criterion("yes"), false: criterion("no") } }
    : {
      type: "choice",
      instructions: request.question,
      criteria: {
        ...Object.fromEntries(request.options.map((option) => [option.id, option.criterion])),
        [NEED_MORE_CONTEXT]: NEED_MORE_CONTEXT_CRITERION,
      },
    };
  return { model: jevModelId, state, questions: withLevel ? { decision, level: levelQuestion() } : { decision } };
}

interface JevDecisionAnswer {
  type?: string;
  choice?: string;
  noul?: number;
  confidence?: number;
  probabilities?: Record<string, number>;
}

interface DecideResponse {
  answers?: { decision?: JevDecisionAnswer; level?: JevScoreAnswer };
  usage?: { input_tokens?: number; output_tokens?: number; cost?: number };
}

export interface DecideVerdict {
  /** The most likely answer, possibly `need_more_context`. */
  choice: string;
  /** The most likely real option. */
  best: string;
  confidence: number;
  /** Most likely first. */
  ranked: Array<{ id: string; probability: number }>;
  decisive: boolean;
}

/** Reads the Decisions API answer. A yes/no probability `p` maps to
 * confidence |2p - 1|, so both kinds share one threshold. `undefined` when
 * it is not a usable answer. */
export function parseDecideAnswer(
  request: DecideRequest,
  answer: JevDecisionAnswer | undefined,
  proceedConfidence = JEV_CONFIDENCE_THRESHOLD,
): DecideVerdict | undefined {
  if (request.kind === "yes_no") {
    if (answer?.type !== "noul" || typeof answer.noul !== "number") return undefined;
    const yes = Math.min(1, Math.max(0, answer.noul));
    const ranked = [{ id: "yes", probability: yes }, { id: "no", probability: 1 - yes }].sort((a, b) => b.probability - a.probability);
    const confidence = Math.abs(2 * yes - 1);
    return { choice: ranked[0].id, best: ranked[0].id, confidence, ranked, decisive: confidence >= proceedConfidence };
  }
  if (answer?.type !== "choice" || typeof answer.confidence !== "number") return undefined;
  const ids = [...request.options.map((option) => option.id), NEED_MORE_CONTEXT];
  const ranked = ids
    .map((id) => ({ id, probability: answer.probabilities?.[id] ?? 0 }))
    .sort((a, b) => b.probability - a.probability);
  const choice = typeof answer.choice === "string" && ids.includes(answer.choice) ? answer.choice : ranked[0].id;
  const best = choice !== NEED_MORE_CONTEXT ? choice : ranked.find((entry) => entry.id !== NEED_MORE_CONTEXT)!.id;
  return {
    choice,
    best,
    confidence: answer.confidence,
    ranked,
    decisive: choice !== NEED_MORE_CONTEXT && answer.confidence >= proceedConfidence,
  };
}

export function decideBand(verdict: DecideVerdict, attempt: number): JevDecisionBand {
  if (verdict.decisive) return "proceed";
  return attempt < MAX_DECIDE_ATTEMPTS ? "verify" : "escalate";
}

/** Same question and options -> same key, so re-asks after gathering evidence count as attempts. */
function attemptKey(request: DecideRequest): string {
  return `${request.question.toLowerCase().replace(/\s+/g, " ")}|${request.options.map((option) => option.id).sort().join(",")}`;
}

const percent = (value: number) => `${Math.round(value * 100)}%`;

function proceedOutput(request: DecideRequest, id: string, confidence: number): string {
  const criterion = request.options.find((option) => option.id === id)?.criterion ?? "";
  return [
    `Decision: ${id} (confidence ${percent(confidence)}).`,
    `Why it applies: ${criterion}`,
    "Carry out this option now. Do not revisit it unless new evidence contradicts it.",
  ].join("\n");
}

function verifyOutput(verdict: DecideVerdict, attempt: number): string {
  const real = verdict.ranked.filter((entry) => entry.id !== NEED_MORE_CONTEXT);
  const leaning = real.slice(0, 2).map((entry) => `${entry.id} (${percent(entry.probability)})`).join(" over ");
  return [
    `No decision yet (attempt ${attempt} of ${MAX_DECIDE_ATTEMPTS}). Leaning ${leaning}.`,
    verdict.choice === NEED_MORE_CONTEXT ? "The facts so far are not enough to choose between the options." : "",
    `Gather evidence that tells ${real.slice(0, 2).map((entry) => entry.id).join(" and ")} apart, then call '${DECIDE_TOOL_NAME}' again with the same question and options, adding the new facts.`,
  ].filter(Boolean).join("\n");
}

export interface DecideToolDependencies {
  config: DecideToolRunConfig;
  /** The request the run was started with, sent to JEV as context. */
  userRequest: string;
  capability: CapabilityName;
  /** The model that runs the session and asks for decisions. */
  model: string;
  host: RunHost;
  ctx: RunContext;
  post?: typeof postJevDecision;
  stats?: JevDecisionStats;
  /** The run's tool observer, for the agent's earlier steps and later outcomes. */
  history?: () => Pick<ToolDecisionObserver, "describeHistoryBefore" | "watchFollowUp"> | undefined;
  /** The run's provider; with `config.stepUp`, lets the run switch to a more capable model on it. */
  provider?: CustomProvider;
  /** Shows a line in the run's log. */
  log?: (message: string) => void;
}

export function decideTool(dependencies: DecideToolDependencies): HostToolHandler {
  const post = dependencies.post ?? postJevDecision;
  const stats = dependencies.stats ?? jevDecisionStats;
  const history = dependencies.history ?? toolDecisionObserver;
  const { config, host } = dependencies;
  const proceedConfidence = config.proceedConfidence ?? JEV_CONFIDENCE_THRESHOLD;
  const attempts = (dependencies.ctx.scratch.decideAttempts ??= new Map<string, number>()) as Map<string, number>;

  return async (args, signal, observer = NOOP_TOOL_EXECUTION_OBSERVER, call) => {
    const parsed = parseDecideRequest(args);
    if (!parsed.ok) {
      observer.step("warn", "decide rejected: invalid request", { error: parsed.error });
      return { ok: false, error: parsed.error };
    }
    const request = parsed.request;
    const key = attemptKey(request);
    const attempt = (attempts.get(key) ?? 0) + 1;
    attempts.set(key, attempt);

    const statsId = `decide_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    stats.update(statsId, {}, {
      at: new Date().toISOString(),
      capability: dependencies.capability,
      model: dependencies.model,
      kind: request.kind,
      question: clip(request.question, 200),
      attempt,
    });
    observer.executedBy({ kind: "model", purpose: "JEV decision", model: config.jevModelId, provider: "OpenRouter", providerId: "openrouter" });

    const source = history();
    const recentSteps = call?.toolCallId ? source?.describeHistoryBefore?.(call.runId, call.sessionId, call.toolCallId) : undefined;
    // With AUTO, the same request also rates the remaining work, so the run
    // can step up to a more capable model it can switch to in place.
    const run = dependencies.ctx.scratch as { autoLevel?: AutoLevel; autoModel?: string };
    const currentLevel = run.autoLevel ?? config.stepUp?.level;
    const currentModel = run.autoModel ?? dependencies.model;
    const targets = config.stepUp && currentLevel && call?.configureExecution
      ? stepUpTargets(config.stepUp, currentLevel, dependencies.provider, currentModel)
      : [];
    const body = decideBody(config.jevModelId, buildDecideState(request, dependencies.userRequest, recentSteps), request, targets.length > 0);
    const unavailable = (reason: string) => {
      stats.update(statsId, { error: reason });
      observer.step("error", `JEV decision failed: ${reason}`, { request: body });
      return {
        ok: false as const,
        error: `The decision service is unavailable (${reason}). Choose the option whose criterion the facts support best, and say which one you chose and why in your next progress update.`,
      };
    };

    let response: JevDecisionResponse<DecideResponse>;
    try {
      response = await post<DecideResponse>(config.apiKey, body, signal);
    } catch (error: unknown) {
      if (signal.aborted) throw error;
      return unavailable(`could not be reached: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (!response.ok) return unavailable(`HTTP ${response.status}`);
    const usage = response.result?.usage;
    if (usage) observer.usage(usage);
    const cost = typeof usage?.cost === "number" ? usage.cost : undefined;
    if (cost !== undefined) stats.update(statsId, { cost });
    const verdict = parseDecideAnswer(request, response.result?.answers?.decision, proceedConfidence);
    if (!verdict) {
      observer.step("warn", "JEV returned an unusable answer", { response: response.result ?? response.text });
      return unavailable("invalid answer");
    }

    const band = decideBand(verdict, attempt);
    stats.update(statsId, { band, choice: verdict.choice, confidence: verdict.confidence });
    if (targets.length > 0 && currentLevel && call) {
      const assessed = assessLevel(response.result?.answers?.level, currentLevel, targets, proceedConfidence);
      if (assessed) stats.update(statsId, { assessedLevel: assessed.level });
      const target = assessed?.target;
      if (target) {
        // Awaited before the tool result is returned, so the agent's next
        // model turn already runs on the new model.
        try {
          await call.configureExecution(target.params);
          run.autoLevel = target.level;
          run.autoModel = target.model;
          stats.update(statsId, { steppedUpTo: target.level });
          observer.step("info", `Stepped the run up to ${AUTO_LEVEL_LABELS[target.level]}: ${target.name}.`, {
            from: { level: currentLevel, model: currentModel },
            jevLevel: assessed.level,
            confidence: assessed.confidence,
            params: target.params,
          });
          dependencies.log?.(`Switched to ${target.name} (${AUTO_LEVEL_LABELS[target.level]}): JEV rated the remaining work as ${AUTO_LEVEL_LABELS[assessed.level]} at ${percent(assessed.confidence)} confidence.`);
        } catch (error: unknown) {
          observer.step("warn", "Stepping the run up failed; it continues on its current model", {
            target: target.name,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }
    // Link what the agent does next to any decision it acts on, so the
    // confidence threshold can be calibrated against real outcomes.
    if (band !== "verify" && call?.toolCallId && source?.watchFollowUp) {
      const followUpCallIds: string[] = [];
      let followUpFailed = 0;
      source.watchFollowUp(call.runId, call.sessionId, call.toolCallId, (next) => {
        followUpCallIds.push(`${call.sessionId}:${next.callId}`);
        if (next.failed) followUpFailed += 1;
        stats.update(statsId, { followUpCallIds: [...followUpCallIds], followUpFailed });
        return followUpCallIds.length < FOLLOW_UP_CALLS;
      });
    }
    observer.step(band === "proceed" ? "info" : "warn", `JEV decision (${config.jevModelId}): ${band}, ${verdict.choice} at ${percent(verdict.confidence)} confidence, attempt ${attempt}.`, {
      probabilities: Object.fromEntries(verdict.ranked.map((entry) => [entry.id, entry.probability])),
      cost,
      request: body,
    });

    if (band === "proceed") {
      attempts.delete(key);
      return { ok: true, output: proceedOutput(request, verdict.choice, verdict.confidence) };
    }
    if (band === "verify") return { ok: true, output: verifyOutput(verdict, attempt) };

    attempts.delete(key);
    if (host.askQuestion) {
      const byLikelihood = verdict.ranked.filter((entry) => entry.id !== NEED_MORE_CONTEXT).slice(0, MAX_USER_OPTIONS);
      try {
        const answer = await host.askQuestion({
          requestId: crypto.randomUUID(),
          question: request.question,
          options: byLikelihood.map((entry) => ({
            label: entry.id,
            description: request.options.find((option) => option.id === entry.id)?.criterion,
          })),
        }, signal);
        stats.update(statsId, { resolvedBy: "user" });
        observer.step("info", "Undecided after the last attempt: the user decided", { answer });
        return {
          ok: true,
          output: `The decision was escalated to the user, who answered: ${answer.trim() || "(no answer)"}\nCarry out the user's choice now.`,
        };
      } catch (error: unknown) {
        if (signal.aborted) throw error;
        observer.step("warn", "Asking the user failed; using JEV's best guess", { error: error instanceof Error ? error.message : String(error) });
      }
    }
    stats.update(statsId, { resolvedBy: "best_guess" });
    return {
      ok: true,
      output: [
        proceedOutput(request, verdict.best, verdict.confidence).replace("Decision:", "Decision (low confidence, best guess):"),
        "Mention in your final summary that this choice was uncertain.",
      ].join("\n"),
    };
  };
}

/** Offers `decide` on a recipe when the run has a JEV config. */
export function applyDecideToolToRecipe(recipe: SessionRecipe, config: DecideToolRunConfig | undefined): SessionRecipe {
  if (!config) return recipe;
  return {
    ...recipe,
    system_prompt: `${recipe.system_prompt ?? ""}${DECIDE_PROMPT_SECTION}`,
    host_tools: [...(recipe.host_tools ?? []), DECIDE_TOOL],
  };
}

export function applyDecideToolHandler(
  handlers: Record<string, HostToolHandler>,
  dependencies: Omit<DecideToolDependencies, "config"> & { config: DecideToolRunConfig | undefined },
): Record<string, HostToolHandler> {
  const { config } = dependencies;
  if (config) handlers[DECIDE_TOOL_NAME] = decideTool({ ...dependencies, config });
  return handlers;
}
