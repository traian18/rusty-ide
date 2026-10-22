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
//
// What differs per provider lives beside this file: request URLs, auth and
// headers in catalogProviders.ts, reading catalog entries in
// catalogModels.ts. This file only sends the requests and reports results.
// ============================================================

import type { CustomProvider, ProviderModel, ProviderQuotaSnapshot } from "../../../store/types";
import { PRESETS } from "../../../integrations/providerConnectionProfiles";
import { catalogRequest, inferenceProbeRequest, resolveDirectApiKey } from "./catalogProviders";
import { catalogModelContext, rawModelsFromPayload, toProviderModels } from "./catalogModels";

function safeRemoteError(status: number, statusText: string, body: string): Error {
  const compact = body.replace(/\s+/g, " ").trim().slice(0, 500);
  return new Error(`Provider request failed (${status} ${statusText})${compact ? `: ${compact}` : ""}`);
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

function unreachableMessage(error: unknown): string {
  return `Could not reach the provider: ${error instanceof Error ? error.message : String(error)}`;
}

/** A preset without a model catalog gets manual model entry instead. */
function assertCatalogDiscoverable(provider: CustomProvider): void {
  const preset = provider.profile ? PRESETS[provider.profile as keyof typeof PRESETS] : undefined;
  if (preset && !preset.supportsModelDiscovery) {
    throw new Error(`Catalog discovery is not supported for ${preset.label}. Manual model entry is available.`);
  }
}

/** The provider's raw catalog response body. */
async function fetchCatalog(provider: CustomProvider): Promise<unknown> {
  const { url, headers } = catalogRequest(provider);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  let response: Response;
  try {
    response = await fetch(url, { method: "GET", headers, signal: controller.signal });
  } catch (error: unknown) {
    throw new Error(isAbortError(error) ? "The provider did not respond within 15 seconds." : unreachableMessage(error));
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    throw safeRemoteError(response.status, response.statusText, await response.text());
  }
  return response.json();
}

/** Direct twin of `discoverProviderModels` (llmProviders.ts) for the
 * `customProvider` this app always has -- see this file's own top doc
 * comment for what's intentionally not ported (pi-ai metadata
 * enrichment). */
export async function discoverProviderModelsDirect(provider: CustomProvider): Promise<ProviderModel[]> {
  assertCatalogDiscoverable(provider);
  const payload = await fetchCatalog(provider);
  return toProviderModels(rawModelsFromPayload(payload), catalogModelContext(provider));
}

export async function testProviderConnectionDirect(provider: CustomProvider): Promise<{ modelCount: number; supportedModelCount: number }> {
  const models = await discoverProviderModelsDirect(provider);
  return {
    modelCount: models.length,
    supportedModelCount: models.filter((model) => model.supported).length,
  };
}

/** Lightweight inference capability test: attempts to reach the provider's
 * chat completions endpoint without requiring model discovery.
 * For OpenAI-compatible services, this tests `/v1/chat/completions` reachability
 * and authentication. Returns success status with optional error message. */
export async function testProviderInferenceDirect(provider: CustomProvider): Promise<{ success: boolean; message?: string }> {
  const { url, headers } = inferenceProbeRequest(provider);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    // HEAD tests connectivity without sending a full request
    const response = await fetch(url, { method: "HEAD", headers, signal: controller.signal });
    return probeResult(response);
  } catch (error: unknown) {
    return {
      success: false,
      message: isAbortError(error) ? "Provider did not respond within 10 seconds" : unreachableMessage(error),
    };
  } finally {
    clearTimeout(timeout);
  }
}

/** Statuses besides 2xx that still prove the endpoint is there: auth or
 * config issues we can report (401, 403), HEAD not allowed (405). */
const REACHABLE_PROBE_STATUSES = new Set([401, 403, 405]);

function probeResult(response: Response): { success: boolean; message?: string } {
  if (response.ok || REACHABLE_PROBE_STATUSES.has(response.status)) {
    return { success: true };
  }
  if (response.status === 404) {
    return { success: false, message: "Inference endpoint not found at this URL" };
  }
  return { success: false, message: `Provider returned status ${response.status}` };
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
