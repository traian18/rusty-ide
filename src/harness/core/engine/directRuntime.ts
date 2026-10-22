// Which model, URL, protocol, key and headers a direct request uses for a
// provider: the per-provider knowledge of directExecution.ts. A new provider
// usually needs only its row in PROVIDER_DEFAULTS (and PROVIDER_HEADERS, if
// its API wants extra headers).

import type { CustomProvider, ProviderModel } from "../../../store/types";
import { parseModelReference } from "../../../store/providerHelpers";
import { getProviderHeaders } from "../../../integrations/providerConnectionHeaders";

interface ProviderDefaults {
  baseUrl: string;
  authType: "bearer" | "anthropic" | "none" | "environment";
  apiType: string;
}

/** Mirrors agent-sidecar/src/services/llmProviders.ts's own
 * `PROVIDER_DEFAULTS` -- only the fields this module actually reads
 * (`baseUrl`/`authType`/`apiType`; the sidecar's own `catalogUrl`/`envVar`/
 * `piProvider` fields belong to catalog discovery and the env-var fallback,
 * neither of which this module does). Kept as a separate literal rather
 * than imported: same reasoning as the rest of this file's port. */
const PROVIDER_DEFAULTS: Record<string, ProviderDefaults> = {
  opencode: { baseUrl: "https://opencode.ai/zen/v1", authType: "bearer", apiType: "openai-completions" },
  openrouter: { baseUrl: "https://openrouter.ai/api/v1", authType: "bearer", apiType: "openai-completions" },
  "opencode-go": { baseUrl: "https://opencode.ai/zen/go/v1", authType: "bearer", apiType: "openai-completions" },
  openai: { baseUrl: "https://api.openai.com/v1", authType: "bearer", apiType: "openai-responses" },
  anthropic: { baseUrl: "https://api.anthropic.com/v1", authType: "anthropic", apiType: "anthropic-messages" },
  "github-models": { baseUrl: "https://models.github.ai/inference", authType: "bearer", apiType: "openai-completions" },
  mistral: { baseUrl: "https://api.mistral.ai/v1", authType: "bearer", apiType: "mistral-conversations" },
};

/** Headers a provider's API expects on every request. */
const PROVIDER_HEADERS: Record<string, Record<string, string>> = {
  "github-models": { Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2026-03-10" },
  openrouter: { "HTTP-Referer": "https://rusty.dev", "X-Title": "Rusty" },
};

/** Mistral's API is not OpenAI Chat Completions: it rejects unknown fields
 * and the `developer` role, and its CORS allow-list rejects the OpenAI SDK's
 * own headers. Requests to it always use pi-ai's native Mistral client, even
 * when the provider was set up as OpenAI-compatible. */
export function isMistralUrl(baseUrl: string): boolean {
  try {
    const host = new URL(baseUrl).hostname;
    return host === "mistral.ai" || host.endsWith(".mistral.ai");
  } catch {
    return false;
  }
}

export function getProviderDefaults(providerId: string): ProviderDefaults | undefined {
  return PROVIDER_DEFAULTS[providerId];
}

export function normalizeApiType(apiType?: string): string {
  if (apiType === "anthropic") return "anthropic-messages";
  return apiType || "openai-completions";
}

/** The first value that is set, as `a || b || c` would pick it. */
function firstSet<T>(values: Array<T | undefined | null | "">): T | undefined {
  return values.find(Boolean) || undefined;
}

function remoteModelId(modelId: string, providerId: string): string {
  const prefix = `${providerId}/`;
  return modelId.startsWith(prefix) ? modelId.slice(prefix.length) : modelId;
}

function resolveProviderModelSelection(
  provider: CustomProvider,
  modelReference: string,
): { model?: ProviderModel; modelId: string; reasoningEffort?: string } {
  const parsed = parseModelReference(modelReference);
  const target = remoteModelId(parsed.baseReference, provider.id);
  const model = provider.models.find((candidate) => candidate.id === parsed.baseReference)
    || provider.models.find((candidate) => (candidate.remoteId || remoteModelId(candidate.id, provider.id)) === target);
  return {
    model,
    modelId: model?.remoteId || target,
    reasoningEffort: parsed.reasoningEffort || model?.reasoningEffort,
  };
}

/** Only the explicit-key half of the sidecar's own `resolveProviderApiKey`
 * -- see directExecution.ts's top doc comment for why the `process.env`
 * fallback is intentionally dropped rather than ported. */
function resolveDirectApiKey(provider: CustomProvider): string {
  return provider.apiKey?.trim() || "";
}

/** What the model's own configuration says, with pi-ai's defaults for anything it leaves out. */
function modelSettings(configured: ProviderModel | undefined, modelId: string) {
  return {
    name: configured?.name || modelId,
    reasoning: configured?.reasoning ?? false,
    thinkingLevelMap: configured?.thinkingLevelMap,
    thinkingBudgets: configured?.thinkingBudgets,
    input: configured?.input || ["text"],
    cost: configured?.cost || { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: configured?.contextWindow || 200_000,
    maxTokens: configured?.maxTokens || 16_384,
    compat: configured?.compat,
    headers: configured?.headers,
  };
}

function syntheticModel(provider: CustomProvider, configuredModel: ProviderModel | undefined, modelId: string): any {
  const defaults = getProviderDefaults(provider.id);
  const configuredBaseUrl = (firstSet([configuredModel?.baseUrl, provider.baseUrl, defaults?.baseUrl]) ?? "").replace(/\/+$/, "");
  if (!configuredBaseUrl) throw new Error(`No base URL is configured for ${provider.name}.`);
  const api = isMistralUrl(configuredBaseUrl)
    ? "mistral-conversations"
    : normalizeApiType(firstSet([configuredModel?.apiType, provider.apiType, defaults?.apiType]));
  // Mistral's SDK takes the server root and adds `/v1/...` itself.
  const baseUrl = api === "mistral-conversations" ? configuredBaseUrl.replace(/\/v1$/, "") : configuredBaseUrl;
  const { name, ...settings } = modelSettings(configuredModel, modelId);
  return { id: modelId, name, api, provider: provider.id, baseUrl, ...settings };
}

function runtimeHeaders(
  provider: CustomProvider,
  model: any,
  apiKey: string,
  authType?: CustomProvider["authType"],
): Record<string, string> | undefined {
  // Custom Headers from the LLM tab override the built-in defaults, but
  // never the auth header below.
  const headers: Record<string, string> = { ...(model.headers || {}), ...PROVIDER_HEADERS[provider.id], ...getProviderHeaders(provider) };
  if (model.api === "anthropic-messages" && authType === "bearer" && apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
  }
  return Object.keys(headers).length ? headers : undefined;
}

export interface ResolvedDirectRuntime {
  providerId: string;
  modelId: string;
  apiKey: string;
  model: any;
  headers?: Record<string, string>;
  reasoningEffort?: string;
}

function authTypeFor(provider: CustomProvider): NonNullable<CustomProvider["authType"]> {
  return firstSet([provider.authType, getProviderDefaults(provider.id)?.authType]) ?? (provider.apiKey ? "bearer" : "none");
}

/** Twin of `resolveLlmRuntime`'s `customProvider` branch (llmRuntime.ts:
 * 122-170) -- the only branch this app's own call pattern ever takes (see
 * directExecution.ts's top doc comment). Returns `undefined` rather than
 * throwing when no API key resolves, so `HybridExecutionAnswerer` can fall
 * back to the sidecar instead of surfacing a hard error for a provider that
 * relies on the sidecar's own env-var fallback. */
export function resolveDirectRuntime(modelReference: string, provider: CustomProvider): ResolvedDirectRuntime | undefined {
  const fallbackModel = provider.models[0];
  const reference = firstSet([modelReference, fallbackModel?.id, fallbackModel?.remoteId]) ?? "";
  const selection = resolveProviderModelSelection(provider, reference);
  const modelId = selection.modelId;
  if (!modelId) return undefined;

  const model = syntheticModel(provider, selection.model || fallbackModel, modelId);

  const authType = authTypeFor(provider);
  const apiKey = resolveDirectApiKey(provider) || (authType === "none" ? "not-needed" : "");
  if (!apiKey) return undefined;

  return {
    providerId: provider.id,
    modelId,
    apiKey,
    model,
    headers: runtimeHeaders(provider, model, apiKey, authType),
    reasoningEffort: selection.reasoningEffort,
  };
}
