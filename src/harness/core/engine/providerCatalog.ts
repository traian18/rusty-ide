// ============================================================
// providerCatalog.ts — Direct-TS port of the sidecar's `/llm/models`,
// `/llm/test`, and `/llm/quota` routes (agent-sidecar/src/server.ts) for
// HTTP-transport providers: `discoverProviderModels`/`testProviderConnection`
// (agent-sidecar/src/services/llmProviders.ts) and the non-managed-provider
// branch of `fetchProviderQuota` (agent-sidecar/src/services/
// providerQuota.ts), called straight from the IDE's own TS layer instead of
// proxying through the sidecar. Same boundary-crossing "port, don't share"
// pattern as directExecution.ts (this project's established precedent for
// crossing the sidecar/IDE runtime boundary).
//
// Deliberately NOT ported: `loadPiModels` (the pi-ai metadata enrichment
// `discoverProviderModels` optionally layers on top of the raw catalog
// response) -- it exists only via the sidecar's Node-only `importEsm`
// loader. Every model this module discovers therefore has no `supported`-
// ness or reasoning-capability hint from pi-ai's own catalog; the
// heuristic fallbacks the sidecar's own code already has for exactly this
// case (`openAiModelSupported`'s regex, `inferredReasoning`'s name-pattern
// check) are what every model gets here, not a v1-only regression -- the
// sidecar falls back to the identical heuristics whenever pi-ai metadata
// isn't available for a given model id.
//
// Managed providers (Copilot/Codex/Claude Code) are entirely out of scope
// here, same as directExecution.ts -- HybridControlPlane
// (../../HybridControlPlane.ts) never calls this module for one of them.
// ============================================================

import type { CustomProvider, ProviderModel, ProviderQuotaSnapshot } from "../../../store/types";
import { normalizeApiType } from "./directExecution";

interface CatalogProviderDefaults {
  baseUrl: string;
  catalogUrl: string;
  authType: "bearer" | "anthropic" | "none" | "environment";
  apiType: string;
}

/** Mirrors agent-sidecar/src/services/llmProviders.ts's own
 * `PROVIDER_DEFAULTS` -- kept as its own literal (not shared with
 * directExecution.ts's own, narrower `PROVIDER_DEFAULTS`) because that
 * module's own doc comment already explains why: `catalogUrl` belongs to
 * catalog discovery specifically, and unifying the two would either bloat
 * the execution-path table with fields it never reads or weaken this one. */
const PROVIDER_DEFAULTS: Record<string, CatalogProviderDefaults> = {
  opencode: {
    baseUrl: "https://opencode.ai/zen/v1",
    catalogUrl: "https://opencode.ai/zen/v1/models",
    authType: "bearer",
    apiType: "openai-completions",
  },
  openrouter: {
    baseUrl: "https://openrouter.ai/api/v1",
    catalogUrl: "https://openrouter.ai/api/v1/models",
    authType: "bearer",
    apiType: "openai-completions",
  },
  "opencode-go": {
    baseUrl: "https://opencode.ai/zen/go/v1",
    catalogUrl: "https://opencode.ai/zen/go/v1/models",
    authType: "bearer",
    apiType: "openai-completions",
  },
  openai: {
    baseUrl: "https://api.openai.com/v1",
    catalogUrl: "https://api.openai.com/v1/models",
    authType: "bearer",
    apiType: "openai-responses",
  },
  anthropic: {
    baseUrl: "https://api.anthropic.com/v1",
    catalogUrl: "https://api.anthropic.com/v1/models",
    authType: "anthropic",
    apiType: "anthropic-messages",
  },
  "github-models": {
    baseUrl: "https://models.github.ai/inference",
    catalogUrl: "https://models.github.ai/catalog/models",
    authType: "bearer",
    apiType: "openai-completions",
  },
};

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function resolveDirectApiKey(provider: CustomProvider): string {
  return provider.apiKey?.trim() || "";
}

function validateHttpUrl(rawUrl: string): string {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error("The provider URL is not valid.");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Provider URLs must use http or https.");
  }
  return parsed.toString();
}

function catalogRequest(provider: CustomProvider): { url: string; headers: Record<string, string> } {
  const defaults = PROVIDER_DEFAULTS[provider.id];
  const baseUrl = provider.baseUrl?.trim() || defaults?.baseUrl || "";
  const catalogUrl = provider.catalogUrl?.trim()
    || defaults?.catalogUrl
    || `${trimTrailingSlash(baseUrl)}/models`;
  const validatedUrl = validateHttpUrl(catalogUrl);
  const parsedCatalogUrl = new URL(validatedUrl);
  if (provider.id === "anthropic" && !parsedCatalogUrl.searchParams.has("limit")) {
    parsedCatalogUrl.searchParams.set("limit", "1000");
  }
  const url = parsedCatalogUrl.toString();
  const apiKey = resolveDirectApiKey(provider);
  const authType = provider.authType || defaults?.authType || (apiKey ? "bearer" : "none");
  const headers: Record<string, string> = { Accept: "application/json" };

  if (authType === "anthropic") {
    if (apiKey) headers["x-api-key"] = apiKey;
    headers["anthropic-version"] = "2023-06-01";
  } else if (authType === "bearer" || authType === "environment") {
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  }

  if (provider.id === "github-models") {
    headers.Accept = "application/vnd.github+json";
    headers["X-GitHub-Api-Version"] = "2026-03-10";
  } else if (provider.id === "openrouter") {
    headers["HTTP-Referer"] = "https://rusty.dev";
    headers["X-Title"] = "Rusty";
  }

  return { url, headers };
}

function safeRemoteError(status: number, statusText: string, body: string): Error {
  const compact = body.replace(/\s+/g, " ").trim().slice(0, 500);
  return new Error(`Provider request failed (${status} ${statusText})${compact ? `: ${compact}` : ""}`);
}

function rawModelsFromPayload(payload: unknown): any[] {
  if (Array.isArray(payload)) return payload;
  const record = payload as { data?: unknown; models?: unknown } | null;
  if (Array.isArray(record?.data)) return record.data;
  if (Array.isArray(record?.models)) return record.models;
  throw new Error("The provider returned an unsupported model-catalog format.");
}

function modelDisplayName(raw: any, remoteId: string): string {
  return raw?.friendly_name
    || raw?.display_name
    || raw?.name
    || remoteId.split("/").pop()
    || remoteId;
}

function githubModelSupported(raw: any): boolean {
  const capabilities = Array.isArray(raw?.capabilities) ? raw.capabilities : [];
  const output = Array.isArray(raw?.supported_output_modalities) ? raw.supported_output_modalities : ["text"];
  return capabilities.includes("tool-calling") && output.includes("text");
}

function openRouterModelSupported(raw: any): boolean {
  if (Array.isArray(raw?.architecture?.output_modalities)) {
    return raw.architecture.output_modalities.includes("text");
  }
  if (typeof raw?.architecture?.modality === "string") {
    return raw.architecture.modality.endsWith("->text");
  }
  return true;
}

function openAiModelSupported(remoteId: string): boolean {
  const id = remoteId.toLowerCase();
  if (/(audio|realtime|transcrib|tts|image|embedding|moderation|whisper|dall-e|sora|search-preview)/.test(id)) {
    return false;
  }
  return /^(gpt-|o\d(?:-|$)|codex-)/.test(id);
}

/** Providers whose catalog serves only models usable through a standard
 * OpenAI-compatible chat-completions endpoint. */
const OPEN_CATALOG_PROVIDERS = new Set(["opencode", "opencode-go", "openrouter"]);

function providerModelId(providerId: string, remoteId: string): string {
  return `${providerId}/${remoteId}`;
}

/** Direct twin of `discoverProviderModels` (llmProviders.ts) for the
 * `customProvider` this app always has -- see this file's own top doc
 * comment for what's intentionally not ported (pi-ai metadata
 * enrichment). */
export async function discoverProviderModelsDirect(provider: CustomProvider): Promise<ProviderModel[]> {
  const { url, headers } = catalogRequest(provider);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  let response: Response;
  try {
    response = await fetch(url, { method: "GET", headers, signal: controller.signal });
  } catch (error: unknown) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error("The provider did not respond within 15 seconds.");
    }
    throw new Error(`Could not reach the provider: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    throw safeRemoteError(response.status, response.statusText, await response.text());
  }

  const payload = await response.json();
  const rawModels = rawModelsFromPayload(payload);
  const defaults = PROVIDER_DEFAULTS[provider.id];
  const providerApiType = normalizeApiType(provider.apiType || defaults?.apiType);
  const providerBaseUrl = trimTrailingSlash(provider.baseUrl?.trim() || defaults?.baseUrl || "");
  const isGitHub = provider.id === "github-models";
  const isOpenCatalog = OPEN_CATALOG_PROVIDERS.has(provider.id);

  return rawModels
    .map((raw: any): ProviderModel | null => {
      const remoteId = String(raw?.id || raw?.key || raw?.name || "").trim();
      if (!remoteId) return null;
      const capabilities = Array.isArray(raw?.capabilities) ? raw.capabilities.map(String) : [];
      const supported = isGitHub
        ? githubModelSupported(raw)
        : provider.id === "openai"
          ? openAiModelSupported(remoteId)
          : provider.id === "openrouter"
            ? openRouterModelSupported(raw)
            : provider.id === "anthropic"
              ? true
              : isOpenCatalog ? true : true;
      const inferredReasoning = provider.id === "openai"
        ? /^(gpt-5|o\d(?:-|$))/.test(remoteId.toLowerCase())
        : raw?.capabilities?.thinking?.supported === true
          || (Array.isArray(raw?.supported_parameters) && (raw.supported_parameters.includes("reasoning") || raw.supported_parameters.includes("include_reasoning")));
      const inferredInput: Array<"text" | "image"> = provider.id === "openai" && supported
        ? ["text", "image"]
        : raw?.capabilities?.image_input?.supported === true
          ? ["text", "image"]
          : (raw?.architecture?.input_modalities || raw?.supported_input_modalities || ["text"]).filter((item: string) => item === "text" || item === "image");
      return {
        id: providerModelId(provider.id, remoteId),
        remoteId,
        name: modelDisplayName(raw, remoteId),
        apiType: normalizeApiType(providerApiType),
        baseUrl: providerBaseUrl,
        supported,
        capabilities,
        reasoning: inferredReasoning,
        input: inferredInput,
        contextWindow: raw?.context_length || raw?.limits?.max_input_tokens || raw?.max_input_tokens,
        maxTokens: raw?.top_provider?.max_completion_tokens || raw?.limits?.max_output_tokens || raw?.max_tokens,
      };
    })
    .filter((model: ProviderModel | null): model is ProviderModel => model !== null)
    .sort((a: ProviderModel, b: ProviderModel) => Number(b.supported) - Number(a.supported) || a.name.localeCompare(b.name));
}

export async function testProviderConnectionDirect(provider: CustomProvider): Promise<{ modelCount: number; supportedModelCount: number }> {
  const models = await discoverProviderModelsDirect(provider);
  return {
    modelCount: models.length,
    supportedModelCount: models.filter((model) => model.supported).length,
  };
}

interface UnavailableProviderDetails {
  source: string;
  message: string;
  manageUrl?: string;
}

/** Verbatim port of providerQuota.ts's own `UNAVAILABLE_PROVIDER_DETAILS`
 * -- none of these providers expose a real quota API, so this table (not a
 * network call) is the entire "direct" quota path for HTTP providers. */
const UNAVAILABLE_PROVIDER_DETAILS: Record<string, UnavailableProviderDetails> = {
  opencode: {
    source: "opencode-console",
    message: "OpenCode does not expose Zen balance through a public API. View it in the OpenCode console.",
    manageUrl: "https://opencode.ai/console",
  },
  "opencode-go": {
    source: "opencode-console",
    message: "OpenCode does not currently expose Go subscription windows through a public API. View them in the OpenCode console.",
    manageUrl: "https://opencode.ai/console",
  },
  openrouter: {
    source: "openrouter-console",
    message: "OpenRouter does not expose credits through a public catalog API. View your balance and limits in the OpenRouter dashboard.",
    manageUrl: "https://openrouter.ai/settings/keys",
  },
  openai: {
    source: "openai-platform",
    message: "A standard OpenAI project key cannot read organization billing quota. An organization Admin API key is required for the Usage API.",
    manageUrl: "https://platform.openai.com/usage",
  },
  anthropic: {
    source: "anthropic-console",
    message: "A standard Anthropic API key cannot read organization usage. The Usage and Cost API requires an Admin API key.",
    manageUrl: "https://console.anthropic.com/settings/usage",
  },
  "github-models": {
    source: "github-models",
    message: "GitHub Models does not expose an account subscription quota through its model catalog API.",
    manageUrl: "https://github.com/marketplace/models",
  },
};

/** Direct twin of `fetchProviderQuota`'s HTTP-provider fallback branch
 * (providerQuota.ts) -- the managed-provider branches above it never run
 * on this path (HybridControlPlane routes those to the sidecar). No
 * network call: none of these providers expose a real quota API, so the
 * sidecar's own implementation is already just this static computation. */
export function fetchProviderQuotaDirect(provider: CustomProvider): ProviderQuotaSnapshot {
  const details = UNAVAILABLE_PROVIDER_DETAILS[provider.id];
  const authType = provider.authType || (resolveDirectApiKey(provider) ? "bearer" : "none");
  const authenticated = authType === "none" || Boolean(resolveDirectApiKey(provider));
  const resolved = details || {
    source: "provider",
    message: "This provider does not advertise an account quota endpoint.",
  };
  return {
    providerId: provider.id,
    providerName: provider.name,
    source: resolved.source,
    fetchedAt: new Date().toISOString(),
    state: authenticated ? "unavailable" : "unauthenticated",
    windows: [],
    message: authenticated
      ? resolved.message
      : `Configure credentials for ${provider.name} to check quota availability.`,
    manageUrl: resolved.manageUrl,
  };
}
