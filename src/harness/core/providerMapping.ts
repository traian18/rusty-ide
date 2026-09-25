// ============================================================
// providerMapping.ts — Decides whether a `CustomProvider` can run a
// core-routed session at all, and (if so) what `SessionRecipe.integration`/
// `integration_config` should be.
//
// Every HTTP-transport provider maps to `"host"` -- the host-routed
// execution backend (see src-tauri/src/harness/host_execution_backend.rs's
// own doc comment): rusty-core itself resolves no provider identity or
// credentials for a core-routed session anymore, so there's nothing left to
// shape into a per-integration `integration_config` here. Provider identity,
// credentials, and the real model id are all resolved on the IDE side of the
// bridge instead, from the run's own `customProvider`/`model`
// (`CoreHarness.ts`'s `handleHostExecuteCall`, Phase 1: the sidecar's
// `streamExecutionRequest`) -- this is also why every apiType the sidecar
// already knows how to reach becomes usable here, not just the three this
// file used to hand-map to rusty-core's own direct integrations.
//
// Managed transports (github-copilot-sdk, openai-codex-app-server,
// anthropic-claude-agent-sdk) map to rusty-core's own subprocess
// integrations (`codex`/`claude-code`/`github-copilot`,
// rusty-core/crates/integrations/*) -- already registered and live in
// HarnessState::harness() (src-tauri/src/harness/mod.rs), just never routed
// to before. `recipe.rs::build_session_builder` fills in the real
// `integration_config.binary_path` from the sidecar's own bundled,
// already-code-signed CLI binaries (see managed_binaries.rs's own doc
// comment for why -- these three CLIs default to a `$PATH`-resolved bare
// command name, which fits a headless embedder expecting a system-installed
// CLI, not this app's sidecar-based login) -- `integration_config: {}` here
// is deliberately empty. These backends' `tool_calls`/`host_managed_tools`
// are both `false` (each CLI edits real disk and runs shell commands
// entirely inside its own sandbox, invisible to the harness -- see
// `codex/src/backend.rs`'s own `capabilities()` comment), so a recipe's
// `host_tools`/`workspace.binding` are simply never exercised for one of
// these three; no capability-specific wiring is needed beyond this mapping.
// ============================================================

import { parseModelReference, resolveProviderModel } from "../../store/providerHelpers";
import type { CustomProvider, ReasoningEffort as UiReasoningEffort } from "../../store/types";
import { resolveProviderRoute } from "./modelRouting";
import type { ReasoningEffort as CoreReasoningEffort } from "./SessionRecipe";

export interface ProviderIntegration {
  integration: string;
  integration_config: Record<string, unknown>;
  reasoningEffort?: CoreReasoningEffort;
  /** Set only for an explicit `modelRouting.ts` route -- the stripped remote
   * model id (no `opencode/` prefix, no `::reasoning=` suffix) the caller
   * must use for `execution_params.model` instead of the raw UI reference.
   * `undefined` for `"host"`/managed-transport results, which still expect
   * the raw reference (resolved later, IDE-side, by `handleHostExecuteCall`/
   * the managed-auth CLI itself). */
  model?: string;
}

export type ProviderMappingResult = ({ supported: true } & ProviderIntegration) | { supported: false; reason: string };

/**
 * rusty-core's `ExecutionParams.reasoning_effort` (harness-protocol/src/
 * backend.rs) has three levels; the UI's own `ReasoningEffort` (store/
 * types.ts) has five, for finer per-model pickers. "minimal" and "xhigh"
 * have no exact match -- clamped to the nearest level that exists rather
 * than dropped. This still has to happen on the IDE side, host-routing or
 * not: `execution_params.reasoning_effort` is a Rust-typed field
 * (`recipe.rs` deserializes it as rusty-core's own 3-level enum) regardless
 * of which backend eventually answers the call.
 */
function toCoreReasoningEffort(effort: UiReasoningEffort): CoreReasoningEffort {
  if (effort === "minimal") return "low";
  if (effort === "xhigh") return "high";
  return effort;
}

/**
 * `modelReference` is the run's own `Input.model` -- the UI's own
 * reference (e.g. `"opencode/big-pickle::reasoning=minimal"`, built by
 * normalizeProviderModel/providerModelVariants). Its reasoning-effort suffix
 * is always read here. For a `"host"`/managed-transport result, the model id
 * itself is left for later, resolved IDE-side from the raw reference carried
 * through `execution_params.model` (see `inline_chat.ts`'s `recipe()`) --
 * but for an explicit `modelRouting.ts` route, the stripped id is already
 * known here and returned as `model`; every recipe builder must prefer it
 * over the raw reference (see `ProviderIntegration.model`'s own doc comment
 * for why: the direct integration clients on the other end always prefer
 * `execution_params.model` over `integration_config`'s own default).
 */
/** Persisted transport labels -> rusty-core's inference-only integration id
 * (rusty-core/crates/integrations/*). */
const MANAGED_TRANSPORT_INTEGRATIONS: Record<string, string> = {
  "github-copilot-sdk": "github-copilot",
  "openai-codex-app-server": "codex",
  "anthropic-claude-agent-sdk": "claude-code",
};

export function mapProviderToIntegration(provider: CustomProvider, modelReference: string): ProviderMappingResult {
  const { reasoningEffort } = parseModelReference(modelReference);
  const coreReasoningEffort = reasoningEffort ? toCoreReasoningEffort(reasoningEffort) : undefined;

  // Per-model-family routing (modelRouting.ts) -- e.g. OpenCode Zen, whose
  // real endpoint splits by model family and supports no CORS at all.
  // Checked before the "host"/managed-transport logic below: a provider
  // absent from PROVIDER_ROUTING_PROFILES gets `undefined` here and falls
  // through unchanged.
  const explicitRoute = resolveProviderRoute(provider, modelReference);
  if (explicitRoute) {
    return {
      supported: true,
      integration: explicitRoute.integration,
      integration_config: explicitRoute.integration_config,
      reasoningEffort: coreReasoningEffort,
      model: explicitRoute.resolvedModelId,
    };
  }

  const managedIntegration = provider.transport ? MANAGED_TRANSPORT_INTEGRATIONS[provider.transport] : undefined;
  if (provider.transport && provider.transport !== "http" && !managedIntegration) {
    return {
      supported: false,
      reason: `managed transport "${provider.transport}" is not supported on core yet`,
    };
  }

  return {
    supported: true,
    integration: managedIntegration ?? "host",
    integration_config: {},
    reasoningEffort: coreReasoningEffort,
    // Managed providers execute inside rusty-core rather than through the
    // IDE-side host answerer, so there is no later model-resolution step for
    // them. Passing the raw UI reference (or no model at all) made Claude
    // or Codex silently use their default model or fail on unstripped ids.
    model: managedIntegration
      ? resolveProviderModel(provider, modelReference).modelId
      : undefined,
  };
}

/**
 * Every core-routed capability used to hard-code `execution_params.max_tokens`
 * at 8192 (4096/4000 in a couple of definitions) -- copied from one
 * investigation and repeated everywhere else without re-verifying it applied
 * generally. It didn't: rusty-core treats a provider's own `finish_reason:
 * "max_tokens"/"length"` as a hard failure (`OUTPUT_LIMIT_REACHED` in
 * harness-core/src/transitions.rs), not a soft truncation, so a low ceiling
 * routinely cut off exploration/analysis answers that needed more room --
 * the model had plenty left to say and never got the tokens to say it.
 *
 * OpenCode Zen used to be the one documented exception: its gateway hung
 * indefinitely (no terminal stream event at all, confirmed live across
 * three models) once max_tokens went above 8192 or was omitted. That
 * finding predates `modelRouting.ts`: at the time, OpenCode Zen was
 * "host"-routed through a raw browser `fetch()` (`HostExecutionBackend`),
 * which has no application-level timeout at all -- a genuinely stalled
 * response there really could hang forever. OpenCode Zen has since moved
 * onto rusty-core's own direct integrations (`anthropic`/`openai-responses`/
 * `openai-compatible`, via the `chatCompletionsFamilyRoute`/
 * `anthropicFamilyRoute` routes below), and every one of those already
 * enforces `RecoveryPolicy.idle_timeout` (`harness-generic-backend`,
 * 600s by default, reset on every byte received -- an inactivity timeout,
 * not a total-duration one, so it never cuts off a slow-but-live stream).
 * A stalled connection today surfaces as a normal, retried
 * `ModelError::Timeout` instead of hanging -- the actual fix for that
 * failure mode is the timeout, not a lower max_tokens, so there is no
 * longer a reason to treat OpenCode Zen differently from every other
 * provider here.
 */
export const CORE_MAX_TOKENS = 128_000;
