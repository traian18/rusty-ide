import { selectableProviderModels } from "../store/providerHelpers";
import type { CustomProvider, ProviderModel, ProviderStatus } from "../store/types";
import { AUTO_LEVELS, type AutoLevel } from "../store/intelligentModelSelectionTypes";

export const AUTO_MODEL_ID = "__rusty_auto_model_selection__";
export const JEV_MODEL_ID = "typesafe/jev-1.13";
export const JEV_LATEST_MODEL_ID = "~typesafe/jev-latest";
export const JEV_CONFIDENCE_THRESHOLD = 0.6;

export interface IntelligentCandidate {
  /** Request-local choice ID. Never treat JEV output as a trusted provider/model reference. */
  id: string;
  provider: CustomProvider;
  model: ProviderModel;
}

export class IntelligentModelSelectionError extends Error {}

export function openRouterModelId(model: Pick<ProviderModel, "id" | "remoteId">): string {
  const id = model.remoteId || model.id;
  return id.startsWith("openrouter/") ? id.slice("openrouter/".length) : id;
}

function normalizedOpenRouterModelId(modelId: string): string {
  return (modelId.startsWith("openrouter/") ? modelId.slice("openrouter/".length) : modelId).toLowerCase();
}

/**
 * True for versioned JEV Decisions models and the latest Decisions alias.
 * The optional leading `~` is accepted for aliases because older saved
 * catalogues and compatible proxies may expose the alias without it.
 * `typesafe/jev-router` is deliberately excluded: it is a chat-completions
 * router, not a model accepted by the Decisions API.
 */
export function isJevDecisionModelId(modelId: string): boolean {
  const id = normalizedOpenRouterModelId(modelId);
  return /^~?typesafe\/jev-(?:latest|\d+(?:\.\d+)*(?:[-.][a-z0-9]+)*)$/.test(id);
}

export function isJevRouterModelId(modelId: string): boolean {
  return normalizedOpenRouterModelId(modelId) === "typesafe/jev-router";
}

export function isJevFamilyModelId(modelId: string): boolean {
  return /^~?typesafe\/jev-/.test(normalizedOpenRouterModelId(modelId));
}

function compareJevModels(left: ProviderModel, right: ProviderModel): number {
  const leftId = openRouterModelId(left);
  const rightId = openRouterModelId(right);
  if (normalizedOpenRouterModelId(leftId).endsWith("/jev-latest")) return -1;
  if (normalizedOpenRouterModelId(rightId).endsWith("/jev-latest")) return 1;
  const leftParts = leftId.match(/jev-(\d+(?:\.\d+)*)/i)?.[1].split(".").map(Number) || [];
  const rightParts = rightId.match(/jev-(\d+(?:\.\d+)*)/i)?.[1].split(".").map(Number) || [];
  const length = Math.max(leftParts.length, rightParts.length);
  for (let index = 0; index < length; index += 1) {
    const difference = (rightParts[index] || 0) - (leftParts[index] || 0);
    if (difference !== 0) return difference;
  }
  return left.name.localeCompare(right.name);
}

/**
 * Returns every Decisions API-capable JEV model in the authenticated model
 * book. Decision models are intentionally unsupported for normal chat
 * execution, so ProviderModel.supported must not be used as an eligibility
 * gate here.
 */
export function findOpenRouterJevModels(provider: CustomProvider | undefined): ProviderModel[] {
  if (!provider || provider.id !== "openrouter") return [];
  return provider.models
    .filter((model) => isJevDecisionModelId(openRouterModelId(model)))
    .sort(compareJevModels);
}

export function resolveOpenRouterJevModel(
  provider: CustomProvider | undefined,
  preferredModelId?: string | null,
): ProviderModel | undefined {
  const models = findOpenRouterJevModels(provider);
  if (preferredModelId) {
    const preferredId = normalizedOpenRouterModelId(preferredModelId);
    const preferred = models.find((model) => normalizedOpenRouterModelId(openRouterModelId(model)) === preferredId);
    if (preferred) return preferred;
  }
  return models.find((model) => normalizedOpenRouterModelId(openRouterModelId(model)).endsWith("/jev-latest"))
    || models.find((model) => normalizedOpenRouterModelId(openRouterModelId(model)) === JEV_MODEL_ID)
    || models[0];
}

export function findOpenRouterJevProvider(
  providers: CustomProvider[],
  preferredModelId?: string | null,
): CustomProvider | undefined {
  return providers.find((provider) =>
    provider.id === "openrouter"
    && Boolean(provider.apiKey?.trim())
    && Boolean(resolveOpenRouterJevModel(provider, preferredModelId))
  );
}

export function intelligentCandidateId(provider: Pick<CustomProvider, "id">, model: Pick<ProviderModel, "id">): string {
  return `${provider.id}:${model.id}`;
}

/** Every model a level can be mapped to: the Agent picker's own models,
 * minus the JEV family (decision models and the JEV chat router). */
export function buildIntelligentCandidates(
  providers: CustomProvider[],
  providerStatus: Record<string, ProviderStatus>,
  activeProviderId: string | null,
): IntelligentCandidate[] {
  return selectableProviderModels(providers, providerStatus, activeProviderId)
    .filter(({ provider, model }) => provider.id !== "openrouter" || !isJevFamilyModelId(openRouterModelId(model)))
    .map(({ provider, model }) => ({
      id: intelligentCandidateId(provider, model),
      provider,
      model,
    }));
}

export type LevelCandidates = Record<AutoLevel, IntelligentCandidate>;

/** Resolves each level's configured model. `missing` lists levels with no
 * model, or whose model is no longer available (provider signed out, model
 * dropped from the catalog); AUTO needs every level resolved. */
export function resolveLevelCandidates(
  providers: CustomProvider[],
  providerStatus: Record<string, ProviderStatus>,
  activeProviderId: string | null,
  levelModels: Record<AutoLevel, string | null>,
): { candidates: Partial<LevelCandidates>; missing: AutoLevel[] } {
  const available = new Map(
    buildIntelligentCandidates(providers, providerStatus, activeProviderId).map((candidate) => [candidate.id, candidate]),
  );
  const candidates: Partial<LevelCandidates> = {};
  const missing: AutoLevel[] = [];
  for (const level of AUTO_LEVELS) {
    const candidate = levelModels[level] ? available.get(levelModels[level]!) : undefined;
    if (candidate) candidates[level] = candidate;
    else missing.push(level);
  }
  return { candidates, missing };
}

export const AUTO_LEVEL_LABELS: Record<AutoLevel, string> = {
  light: "Light",
  standard: "Standard",
  heavy: "Heavy",
};

/** The situations each level covers, lowest first. JEV scores the request
 * against these (as a `score` rubric); they are also the Settings copy. */
export const AUTO_LEVEL_CRITERIA: Record<AutoLevel, string> = {
  light: "Conversation, factual or general-knowledge questions, explaining a concept or a short piece of code, and small single-file edits such as renames, typo fixes, or formatting.",
  standard: "Typical development work: implementing a feature or fixing a bug across a few files, writing tests, reviewing a change, or debugging with a clear error message.",
  heavy: "Hard, open-ended work: architecture or design decisions, large refactors across many files, subtle bugs such as concurrency or performance problems, and long multi-step agent tasks.",
};

/** JEV shares a 32k-token window between state and rubric; long pasted
 * context says little about difficulty beyond its first part. */
const MAX_REQUEST_CHARS = 16_000;

function buildDecisionState(query: string): string {
  const request = query.length > MAX_REQUEST_CHARS
    ? `${query.slice(0, MAX_REQUEST_CHARS)}\n[… ${query.length - MAX_REQUEST_CHARS} more characters of request and attached context]`
    : query;
  return [
    "A user sent this request to an AI assistant inside a code editor. The assistant can read and edit the user's project files and run tools.",
    "User request:",
    request,
  ].join("\n");
}

const LEVEL_INSTRUCTIONS =
  "How capable must the AI model be to complete this request well? Choose the lowest level that is enough: more capable models are slower and more expensive, so a stronger model than needed is a worse answer.";

/**
 * JEV's most likely level, stepped up one when it is unsure and the runner-up
 * is a higher level: under-powering a request costs more than over-paying.
 */
export function resolveAutoLevel(
  probabilities: Partial<Record<AutoLevel, number>>,
  confidence: number,
): { level: AutoLevel; jevLevel: AutoLevel; escalated: boolean } {
  const ranked = AUTO_LEVELS
    .map((level, index) => ({ level, index, probability: probabilities[level] ?? 0 }))
    .sort((a, b) => b.probability - a.probability || b.index - a.index);
  const [top, runnerUp] = ranked;
  const escalated = confidence < JEV_CONFIDENCE_THRESHOLD
    && runnerUp !== undefined
    && runnerUp.index > top.index
    && top.index < AUTO_LEVELS.length - 1;
  return {
    level: escalated ? AUTO_LEVELS[top.index + 1] : top.level,
    jevLevel: top.level,
    escalated,
  };
}

/** One JEV Decisions API exchange, reported whether it succeeded or not so
 * Tool Execution Observability can show the raw request and response. */
export interface JevDecisionTrace {
  id: string;
  jevModelId: string;
  query: string;
  startedAt: string;
  finishedAt: string;
  request: unknown;
  httpStatus?: number;
  response?: unknown;
  outcome: "selected" | "failed";
  /** JEV's most likely level, and the level used after the unsure step-up. */
  jevLevel?: AutoLevel;
  level?: AutoLevel;
  escalated?: boolean;
  confidence?: number;
  probabilities?: Partial<Record<AutoLevel, number>>;
  /** The candidate the used level maps to. */
  selectedModel?: string;
  cost?: number;
  error?: string;
}

export interface IntelligentSelection {
  level: AutoLevel;
  escalated: boolean;
  candidate: IntelligentCandidate;
  confidence: number;
  jevModelId: string;
  cost?: number;
}

export async function selectIntelligentModel(
  query: string,
  openRouterProvider: CustomProvider,
  levelCandidates: LevelCandidates,
  preferredJevModelId?: string | null,
  onTrace?: (trace: JevDecisionTrace) => void,
): Promise<IntelligentSelection> {
  const apiKey = openRouterProvider.apiKey?.trim();
  if (!apiKey) throw new IntelligentModelSelectionError("OpenRouter is not connected.");
  const jevModel = resolveOpenRouterJevModel(openRouterProvider, preferredJevModelId);
  if (!jevModel) throw new IntelligentModelSelectionError("No JEV Decisions API model is available in the OpenRouter model book.");
  const jevModelId = openRouterModelId(jevModel);
  const body = {
    model: jevModelId,
    state: buildDecisionState(query),
    questions: {
      level: {
        type: "score",
        instructions: LEVEL_INSTRUCTIONS,
        criteria: AUTO_LEVELS.map((level) => `${AUTO_LEVEL_LABELS[level]}: ${AUTO_LEVEL_CRITERIA[level]}`),
      },
    },
  };

  const trace: JevDecisionTrace = {
    id: `jev_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    jevModelId,
    query,
    startedAt: new Date().toISOString(),
    finishedAt: "",
    request: body,
    outcome: "failed",
  };
  const fail = (message: string): never => {
    trace.error = message;
    throw new IntelligentModelSelectionError(message);
  };

  try {
    let response: Response;
    try {
      response = await fetch("https://openrouter.ai/api/alpha/decisions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          "HTTP-Referer": "https://rusty.dev",
          "X-Title": "Rusty",
        },
        body: JSON.stringify(body),
      });
    } catch (error) {
      const detail = error instanceof Error ? `: ${error.message}` : ".";
      return fail(`OpenRouter JEV selection could not be reached${detail}`);
    }
    trace.httpStatus = response.status;

    const text = await response.text().catch(() => "");
    let result: {
      answers?: { level?: { type?: string; confidence?: number; probabilities?: Record<string, number> } };
      usage?: { cost?: number };
    } | undefined;
    try {
      result = JSON.parse(text) as typeof result;
      trace.response = result;
    } catch {
      trace.response = text;
    }

    if (!response.ok) {
      return fail(`OpenRouter JEV selection failed (${response.status}).`);
    }
    if (!result) return fail("OpenRouter JEV returned an invalid answer.");
    if (typeof result.usage?.cost === "number") trace.cost = result.usage.cost;

    const answer = result.answers?.level;
    const confidence = answer?.confidence;
    // Score probabilities are keyed by rubric position: "0" is the first level.
    const probabilities: Partial<Record<AutoLevel, number>> = {};
    AUTO_LEVELS.forEach((level, index) => {
      const probability = answer?.probabilities?.[String(index)];
      if (typeof probability === "number") probabilities[level] = probability;
    });
    if (answer?.type !== "score" || typeof confidence !== "number" || Object.keys(probabilities).length === 0) {
      return fail("OpenRouter JEV returned an invalid answer.");
    }
    trace.confidence = confidence;
    trace.probabilities = probabilities;

    const { level, jevLevel, escalated } = resolveAutoLevel(probabilities, confidence);
    const candidate = levelCandidates[level];
    trace.jevLevel = jevLevel;
    trace.level = level;
    trace.escalated = escalated;
    trace.selectedModel = candidate.id;
    trace.outcome = "selected";
    return { level, escalated, candidate, confidence, jevModelId, cost: trace.cost };
  } finally {
    trace.finishedAt = new Date().toISOString();
    try {
      onTrace?.(trace);
    } catch (error) {
      console.warn("JEV selection trace could not be recorded:", error);
    }
  }
}
