// ============================================================
// catalogProviders.ts — What each known provider needs for the requests
// providerCatalog.ts sends: default URLs and auth, catalog URL rewrites,
// and extra headers. Kept as data apart from the fetch logic so a new
// provider or provider quirk is an entry here, not another branch there.
// ============================================================

import type { CustomProvider } from "../../../store/types";

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
export const PROVIDER_DEFAULTS: Record<string, CatalogProviderDefaults> = {
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
  mistral: {
    baseUrl: "https://api.mistral.ai/v1",
    catalogUrl: "https://api.mistral.ai/v1/models",
    authType: "bearer",
    apiType: "mistral-conversations",
  },
};

interface CatalogQuirks {
  /** Rewrites the catalog URL in place before it is fetched. */
  adjustUrl?: (catalogUrl: URL, apiKey: string) => void;
  /** Headers the catalog needs on top of Accept and auth; may replace Accept. */
  headers?: Record<string, string>;
}

function useOpenRouterUserCatalog(catalogUrl: URL, apiKey: string): void {
  // Only the official catalog: a custom proxy or deliberately customized
  // catalog remains untouched.
  if (catalogUrl.hostname !== "openrouter.ai") return;
  if (apiKey && trimTrailingSlash(catalogUrl.pathname) === "/api/v1/models") {
    // `/models` is OpenRouter's public, global catalog. `/models/user` is
    // filtered for the bearer key's provider preferences, privacy policy,
    // and guardrails. This also repairs older saved provider configs that
    // still persist the public URL.
    catalogUrl.pathname = "/api/v1/models/user";
  }
  if (!catalogUrl.searchParams.has("output_modalities")) {
    // OpenRouter's catalogue defaults to text-output models only, which
    // hides the JEV Decisions API models (output modality `decisions`).
    // Request every modality; `openRouterModelSupported` still keeps
    // non-text entries out of the chat pickers.
    catalogUrl.searchParams.set("output_modalities", "all");
  }
}

/** Anthropic pages its catalog; ask for every model in one page. */
function requestWholeAnthropicCatalog(catalogUrl: URL): void {
  if (!catalogUrl.searchParams.has("limit")) catalogUrl.searchParams.set("limit", "1000");
}

const CATALOG_QUIRKS = new Map<string, CatalogQuirks>([
  ["anthropic", { adjustUrl: requestWholeAnthropicCatalog }],
  ["github-models", { headers: { Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2026-03-10" } }],
  ["openrouter", { adjustUrl: useOpenRouterUserCatalog, headers: { "HTTP-Referer": "https://rusty.dev", "X-Title": "Rusty" } }],
]);

export function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

export function resolveDirectApiKey(provider: CustomProvider): string {
  return provider.apiKey?.trim() || "";
}

/** The provider's own base URL, else its known default (untrimmed). */
export function providerBaseUrl(provider: CustomProvider): string {
  return provider.baseUrl?.trim() || PROVIDER_DEFAULTS[provider.id]?.baseUrl || "";
}

function providerAuthType(provider: CustomProvider, apiKey: string): string {
  return provider.authType || PROVIDER_DEFAULTS[provider.id]?.authType || (apiKey ? "bearer" : "none");
}

function authHeaders(authType: string, apiKey: string): Record<string, string> {
  const headers: Record<string, string> = {};
  if (authType === "anthropic") {
    if (apiKey) headers["x-api-key"] = apiKey;
    headers["anthropic-version"] = "2023-06-01";
  } else if (authType === "bearer" || authType === "environment") {
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  }
  return headers;
}

function requestHeaders(provider: CustomProvider): Record<string, string> {
  const apiKey = resolveDirectApiKey(provider);
  return { Accept: "application/json", ...authHeaders(providerAuthType(provider, apiKey), apiKey) };
}

/** The provider's own extra headers, secret ones left out. */
function plainProviderHeaders(provider: CustomProvider): Record<string, string> {
  if (!Array.isArray(provider.headers)) return {};
  const headers: Record<string, string> = {};
  for (const header of provider.headers) {
    if (header.name && !header.secret) headers[header.name] = header.value || "";
  }
  return headers;
}

export function validateHttpUrl(rawUrl: string): string {
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

function catalogUrlFor(provider: CustomProvider): string {
  return provider.catalogUrl?.trim()
    || PROVIDER_DEFAULTS[provider.id]?.catalogUrl
    || `${trimTrailingSlash(providerBaseUrl(provider))}/models`;
}

export interface ProviderRequest {
  url: string;
  headers: Record<string, string>;
}

/** The GET that lists the provider's models. */
export function catalogRequest(provider: CustomProvider): ProviderRequest {
  const catalogUrl = new URL(validateHttpUrl(catalogUrlFor(provider)));
  const quirks = CATALOG_QUIRKS.get(provider.id);
  quirks?.adjustUrl?.(catalogUrl, resolveDirectApiKey(provider));
  return { url: catalogUrl.toString(), headers: { ...requestHeaders(provider), ...quirks?.headers } };
}

/** The HEAD that checks the provider's chat completions endpoint. */
export function inferenceProbeRequest(provider: CustomProvider): ProviderRequest {
  return {
    url: validateHttpUrl(`${trimTrailingSlash(providerBaseUrl(provider))}/chat/completions`),
    headers: { ...requestHeaders(provider), ...plainProviderHeaders(provider) },
  };
}
