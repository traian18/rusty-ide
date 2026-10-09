import { baseModelReference } from "../../store/providerHelpers";
import type { CustomProvider } from "../../store/types";
import type { ContextCompactionRunConfig } from "./decideToolConfig";
import type { ExecutionRequest } from "./engine/ExecutionProtocol";
import type { SessionRecipe } from "./SessionRecipe";

/** The run's model window from its provider's catalog, when it lists one.
 * `model` is the UI reference, which may carry a `<providerId>/` prefix and a
 * `::reasoning=<effort>` suffix; both are matched the way the provider
 * resolves them. */
export function contextWindowOf(provider: unknown, model: unknown): number | undefined {
  if (typeof model !== "string" || !model) return undefined;
  const candidate = provider as Partial<CustomProvider> | undefined;
  const models = candidate?.models;
  if (!Array.isArray(models)) return undefined;
  const base = baseModelReference(model);
  const prefix = candidate?.id ? `${candidate.id}/` : "";
  const bare = prefix && base.startsWith(prefix) ? base.slice(prefix.length) : base;
  const entry = models.find((entry) => entry.id === base)
    ?? models.find((entry) => entry.remoteId === bare || entry.id === bare || (prefix && entry.id === `${prefix}${bare}`));
  const window = entry?.contextWindow;
  return typeof window === "number" && window > 0 ? window : undefined;
}

/** Share of the model's window, in characters, that earlier chat turns may
 * use; tool output, the system prompt and the reply need the rest. Unknown
 * windows keep the whole history, as before. */
export function historyBudgetChars(provider: unknown, model: unknown): number | undefined {
  const window = contextWindowOf(provider, model);
  return window ? Math.floor(window * 4 * 0.4) : undefined;
}

/** The recipe's compaction block for a run: the snapshot taken where the run
 * started, plus the model's context window so compaction can size itself. */
export function compactionRecipe(
  config: ContextCompactionRunConfig | undefined,
  provider: unknown,
  model: unknown,
): SessionRecipe["context_compaction"] {
  if (!config) return undefined;
  const contextWindow = contextWindowOf(provider, model);
  return {
    mode: config.mode,
    ...(contextWindow ? { context_window: contextWindow } : {}),
    ...(config.mode === "smart" && config.jev
      ? { jev: { api_key: config.jev.apiKey, model_id: config.jev.jevModelId, ...(config.jev.confidence !== undefined ? { confidence: config.jev.confidence } : {}) } }
      : {}),
  };
}

/** rusty-core tags its background summary requests with this purpose
 * (`harness_context::CONTEXT_SUMMARY_PURPOSE`), so they are not mistaken for
 * the agent's own turns. */
export const CONTEXT_SUMMARY_PURPOSE = "context_summary";

export function isContextSummaryRequest(request: ExecutionRequest): boolean {
  const options = request.params?.provider_options as { rusty?: { purpose?: unknown } } | null | undefined;
  return options?.rusty?.purpose === CONTEXT_SUMMARY_PURPOSE;
}
