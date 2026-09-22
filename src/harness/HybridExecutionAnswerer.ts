// ============================================================
// HybridExecutionAnswerer.ts — Phase 2's dispatcher (Host-routed execution
// backend plan): answers directly via DirectExecutionAnswerer (core/engine/
// DirectExecutionAnswerer.ts) for a request whose provider resolves to one
// of the three ported apiTypes with a usable API key.
//
// Sidecar-removal Phase 8c: the fallback used to be SidecarExecutionAnswerer
// (sidecar/SidecarExecutionAnswerer.ts, Phase 1) -- now gone along with the
// rest of the sidecar. What used to fall back silently now throws a clear,
// honest error instead: google-generative-ai providers, any provider
// relying on the sidecar's own env-var API-key fallback (directExecution.ts's
// own doc comment explains why that fallback was never ported), and any
// provider in NO_CORS_EXECUTION_PROVIDER_IDS (OpenCode/OpenCode-Go --
// confirmed live to have no CORS support on their completions endpoint at
// all, so a direct browser `fetch()` to them fails outright regardless of
// what answers it). These are real, permanent capability regressions from
// removing the sidecar, accepted deliberately (see the sidecar-removal plan
// doc's Phase 7 decision) rather than silently discovered later.
//
// This is the composition root's own file, not core/'s: same reasoning as
// index.ts (the class name and "Hybrid" prefix are kept for now -- the
// managed-auth providers (Copilot/Codex/Claude Code) still make this a real
// dispatch between two answerable cases, not a single always-true path,
// even with the sidecar gone: DirectExecutionAnswerer only handles the
// three ported HTTP apiTypes, and a managed-auth provider's model
// execution runs entirely inside rusty-core's own subprocess integration,
// never reaching this class at all -- see providerMapping.ts).
// ============================================================

import type { CustomProvider } from "../store/types";
import type { ExecutionAnswerer } from "./core/CoreHarness";
import { DirectExecutionAnswerer } from "./core/engine/DirectExecutionAnswerer";
import { NO_CORS_EXECUTION_PROVIDER_IDS, PORTED_API_TYPES, resolveDirectRuntime } from "./core/engine/directExecution";
import type { ExecutionEvent, ExecutionRequest, ExecutionResult } from "./core/engine/ExecutionProtocol";

function canAnswerDirectly(request: ExecutionRequest, customProvider: unknown): boolean {
  const provider = customProvider as CustomProvider | null | undefined;
  if (!provider || provider.transport) return false;
  if (NO_CORS_EXECUTION_PROVIDER_IDS.has(provider.id)) return false;
  const runtime = resolveDirectRuntime(request.params?.model || "", provider);
  return !!runtime && PORTED_API_TYPES.has(runtime.model.api);
}

function explainWhyNotDirect(request: ExecutionRequest, customProvider: unknown): string {
  const provider = customProvider as CustomProvider | null | undefined;
  if (!provider) return "no provider was supplied for this run.";
  if (provider.transport) return `provider '${provider.id}' is a managed-auth transport, which should never reach HybridExecutionAnswerer (see providerMapping.ts) -- this is a routing bug, not an unsupported provider.`;
  if (NO_CORS_EXECUTION_PROVIDER_IDS.has(provider.id)) return `provider '${provider.id}' has no CORS support on its completions endpoint (confirmed live) and cannot be called directly from the browser. There is no fallback for this any more -- the Node sidecar that used to proxy around it has been removed.`;
  const runtime = resolveDirectRuntime(request.params?.model || "", provider);
  if (!runtime) return `could not resolve a runtime for model '${request.params?.model || "(none)"}' on provider '${provider.id}' -- check the provider's apiKey/baseUrl/model configuration.`;
  return `apiType '${runtime.model.api}' isn't one of the three ported types (${[...PORTED_API_TYPES].join(", ")}). There is no fallback for this any more -- the Node sidecar that used to handle every other apiType has been removed.`;
}

export class HybridExecutionAnswerer implements ExecutionAnswerer {
  private readonly direct: ExecutionAnswerer;

  constructor(options: { direct?: ExecutionAnswerer } = {}) {
    this.direct = options.direct ?? new DirectExecutionAnswerer();
  }

  execute(
    request: ExecutionRequest,
    customProvider: unknown,
    onEvent: (event: ExecutionEvent) => void,
    signal: AbortSignal,
  ): Promise<ExecutionResult> {
    if (!canAnswerDirectly(request, customProvider)) {
      return Promise.reject(new Error(`Cannot execute this model directly: ${explainWhyNotDirect(request, customProvider)}`));
    }
    return this.direct.execute(request, customProvider, onEvent, signal);
  }
}
