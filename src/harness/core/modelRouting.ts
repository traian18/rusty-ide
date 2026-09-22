// ============================================================
// modelRouting.ts — Per-model-family routing for gateway-style providers
// whose execution endpoint splits by model (OpenCode Zen today; any future
// provider with the same shape reuses this same mechanism).
//
// `providerMapping.ts` maps a `CustomProvider` to `"host"` by default --
// browser-side execution via `HostExecutionBackend`. That's wrong for a
// provider whose real endpoint neither speaks one uniform wire shape nor
// supports CORS at all (see `directExecution.ts`'s own
// `NO_CORS_EXECUTION_PROVIDER_IDS` doc comment for the live evidence on
// OpenCode Zen specifically): those sessions need to route straight to one
// of rusty-core's own direct HTTP integrations (`anthropic`/
// `openai-compatible`/`openai-responses`/`gemini`), bypassing
// `HostExecutionBackend`/the browser entirely, the same way Phase 3's
// managed-auth sessions already do.
//
// This is deliberately a registry, not a single `if (provider.id ===
// "opencode")` branch: a provider absent from `PROVIDER_ROUTING_PROFILES`
// falls through to `providerMapping.ts`'s existing `"host"` behavior
// unchanged, and adding a fifth OpenCode Zen model family -- or a wholly new
// gateway-style provider -- is one new `ModelRoute`/`PROVIDER_ROUTING_
// PROFILES` entry, never a change to the dispatch logic itself. A real
// first-class Gemini provider (coming per the user's own stated near-term
// plan) reuses the same registered `"gemini"` integration this file already
// knows how to route to -- no new Rust code, just a new profile entry (or,
// for a single-family provider, no profile at all -- straight to
// `providerMapping.ts`'s own managed-transport-style direct mapping).
// ============================================================

import type { CustomProvider } from "../../store/types";
import { resolveDirectRuntime } from "./engine/directExecution";

export interface ModelRoute {
  /** Tried in registration order; first match wins. */
  matches(resolvedModelId: string): boolean;
  /** A rusty-core `IntegrationFactory` id (`src-tauri/src/harness/mod.rs`'s
   * `.register_integration(...)` list). */
  integration: string;
  buildConfig(apiKey: string, resolvedModelId: string): Record<string, unknown>;
}

export interface ProviderRoutingProfile {
  routes: ModelRoute[];
}

/**
 * OpenCode Zen (and its `opencode-go` twin) split what used to be one
 * unified `/chat/completions` endpoint into four families, confirmed live
 * against the real API today (`GET /zen/v1/models`'s full 71-model catalog,
 * classified with zero ambiguous cases):
 *
 *   Claude / Qwen / Union Alpha  -> POST {base}/v1/messages           (Anthropic Messages)
 *   GPT / Grok / Muse Spark      -> POST {base}/v1/responses          (OpenAI Responses API)
 *   Gemini                       -> POST {base}/v1/models/<model-id>  (Gemini-native)
 *   everything else              -> POST {base}/v1/chat/completions   (OpenAI Chat Completions)
 *
 * None of the four support CORS (checked live with `curl -X OPTIONS ...
 * -H "Origin: tauri://localhost"` against all four, not just one) -- so
 * every OpenCode Zen model, not just the three that used to 400, needs to
 * route off the browser entirely.
 */
function anthropicFamilyRoute(baseUrl: string): ModelRoute {
  return {
    matches: (modelId) =>
      modelId.startsWith("claude-") ||
      modelId.startsWith("haiku") ||
      modelId.startsWith("qwen") ||
      modelId === "union-alpha",
    integration: "anthropic",
    buildConfig: (apiKey, resolvedModelId) => ({
      api_key: apiKey,
      base_url: baseUrl,
      default_model: resolvedModelId,
      default_max_tokens: 8192,
    }),
  };
}

function responsesFamilyRoute(baseUrlV1: string): ModelRoute {
  return {
    matches: (modelId) =>
      modelId.startsWith("gpt-") || modelId.startsWith("grok-") || modelId.startsWith("muse-spark-"),
    integration: "openai-responses",
    buildConfig: (apiKey, resolvedModelId) => ({
      api_key: apiKey,
      base_url: baseUrlV1,
      default_model: resolvedModelId,
    }),
  };
}

/** Catch-all -- must stay last in a profile's `routes` array. Covers
 * DeepSeek/GLM/MiniMax/Kimi/Big Pickle/the free-tier misc models today, and
 * any future addition to OpenCode Zen's catalog that isn't one of the three
 * more specific families above.
 *
 * `supports_reasoning: true` -- confirmed these OpenCode Zen models (DeepSeek/
 * GLM/Kimi/Big Pickle et al.) do support extended thinking; opts this route's
 * `openai-compatible` config into sending `reasoning_effort` and parsing
 * `delta.reasoning_content`/`delta.reasoning` back (see
 * `harness-integration-openai::OpenAiConfig::supports_reasoning`'s own doc
 * comment -- it's an opt-in per endpoint, not a blanket default, since the
 * same client also backs plain OpenAI and arbitrary local endpoints that
 * reject an unrecognized param). */
function chatCompletionsFamilyRoute(baseUrlV1: string): ModelRoute {
  return {
    matches: () => true,
    integration: "openai-compatible",
    buildConfig: (apiKey, resolvedModelId) => ({
      api_key: apiKey,
      base_url: baseUrlV1,
      model: resolvedModelId,
      supports_reasoning: true,
    }),
  };
}

// Gemini family (`gemini-*`) is deliberately NOT registered below yet.
// OpenCode Zen's Gemini endpoint's real auth mechanism was probed live this
// session (no-auth, bearer header, x-api-key header, `key=` query -- every
// header style returned the same generic "Missing API key" error, and the
// query-param style hit a likely bug on Zen's own router) and never
// confirmed. Shipping a guessed auth style here would silently fail every
// Gemini-family request behind a route that looks like it should work.
// Enable this once a real call against a real OpenCode Zen API key succeeds
// -- see the OpenCode Zen per-model-family routing plan's own gate.

export const PROVIDER_ROUTING_PROFILES: Record<string, ProviderRoutingProfile> = {
  opencode: {
    routes: [
      anthropicFamilyRoute("https://opencode.ai/zen"),
      responsesFamilyRoute("https://opencode.ai/zen/v1"),
      chatCompletionsFamilyRoute("https://opencode.ai/zen/v1"),
    ],
  },
  "opencode-go": {
    routes: [
      anthropicFamilyRoute("https://opencode.ai/zen/go"),
      responsesFamilyRoute("https://opencode.ai/zen/go/v1"),
      chatCompletionsFamilyRoute("https://opencode.ai/zen/go/v1"),
    ],
  },
  openrouter: {
    routes: [
      chatCompletionsFamilyRoute("https://openrouter.ai/api/v1"),
    ],
  },
};

export interface ResolvedProviderRoute {
  integration: string;
  integration_config: Record<string, unknown>;
  /** The stripped remote model id this route resolved (no `opencode/`
   * prefix, no `::reasoning=` suffix) -- callers must send THIS as
   * `execution_params.model`, not the raw reference. Every direct
   * integration's own client prefers `ModelRequest.model` (from
   * `execution_params.model`) over `integration_config.default_model`/
   * `model` whenever it's set, so leaving `execution_params.model` as the
   * raw reference silently defeats the resolution this function just did. */
  resolvedModelId: string;
}

/**
 * Reuses `directExecution.ts`'s own model-reference resolution
 * (`resolveDirectRuntime` -> `resolveProviderModelSelection`) rather than
 * re-deriving the `opencode/` prefix / `::reasoning=` suffix stripping here
 * -- same resolved model id and API key a direct-execution run would use,
 * just handed to a different integration instead of pi-ai's request
 * modules. Returns `undefined` (not a route) whenever there's nothing to
 * override: no routing profile for this provider, no API key configured
 * yet, or `resolveDirectRuntime` throws (e.g. a provider whose `base_url`
 * was cleared) -- `providerMapping.ts` falls through to its existing
 * `"host"`/managed-transport logic unchanged in every one of these cases.
 */
export function resolveProviderRoute(
  provider: CustomProvider,
  modelReference: string,
): ResolvedProviderRoute | undefined {
  const profile = PROVIDER_ROUTING_PROFILES[provider.id];
  if (!profile) return undefined;

  let runtime;
  try {
    runtime = resolveDirectRuntime(modelReference, provider);
  } catch {
    return undefined;
  }
  if (!runtime) return undefined;

  const route = profile.routes.find((candidate) => candidate.matches(runtime.modelId));
  if (!route) return undefined;

  return {
    integration: route.integration,
    integration_config: route.buildConfig(runtime.apiKey, runtime.modelId),
    resolvedModelId: runtime.modelId,
  };
}
