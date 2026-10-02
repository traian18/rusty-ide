import { baseModelReference, isCopilotProvider, isManagedAuthProvider, providerHasModelReference } from "./providerHelpers";
import { providerStatusOrUnknown } from "../integrations/registryTypes";
import type { CustomProvider, ProviderStatus } from "./types";

/**
 * The one execution-time provider resolver (REFACTOR_PLAN.md PR 3c),
 * replacing 8 independent `getState()` call sites (Workspace.tsx's
 * executeNode, useExplorerWebSocket.ts x3, useEdgeWebSocket.ts,
 * AgentTab.tsx, SkillsTab.tsx, ReconciliationGraphPane.tsx x2) that each
 * hand-rolled (or, in Workspace.tsx's case, string-split-rolled) the same
 * lookup and then sent whatever they found -- or `null` -- to the sidecar
 * unconditionally, with no idea whether the resolved provider would
 * actually work.
 */
export type ExecutionResolution =
  | { ok: true; provider: CustomProvider }
  | { ok: false; reason: "no-model-selected"; message: string }
  | { ok: false; reason: "unknown-provider"; message: string }
  /** The provider is managed and its registry status is still `unknown`
      or `loading` -- normal for the first several seconds after launch,
      since e.g. Copilot's status check has no server-side timeout of its
      own. Distinct from `not-authenticated`: "sign in" is the wrong
      message for a check that just hasn't settled yet. */
  | { ok: false; reason: "status-pending"; message: string }
  /** The provider is managed and its registry status is `unauthenticated`
      or `error` -- the user actually needs to sign in. */
  | { ok: false; reason: "not-authenticated"; message: string };

/**
 * Finds the provider that owns `modelReference` (via the existing
 * providerHasModelReference). An unowned, provider-qualified model must
 * fail here: sending it to the active provider can ask Copilot to run an
 * unrelated OpenAI or Codex model. Bare legacy model ids and empty choices
 * may still use the active provider.
 *
 * A REGULAR provider (no status-check cycle of its own --
 * providerCoordinator.ts only ever polls the three managed provider ids)
 * is never gated on registry status: providerStatusOrUnknown reads back
 * `{kind: "unknown"}` for one forever, and gating on that would
 * permanently block every custom/local provider. Only a MANAGED
 * provider's resolution can fail on status -- mirrors
 * discoveryPolicy.ts's isEligibleForDiscovery rule exactly. Do not
 * "fix" this asymmetry; see resolveExecutionProvider.test.ts's named
 * regression case.
 */
export function resolveExecutionProvider(
  customProviders: CustomProvider[],
  providerStatus: Record<string, ProviderStatus>,
  activeCustomProviderId: string | null,
  modelReference: string | undefined,
): ExecutionResolution {
  let provider: CustomProvider | undefined;
  if (modelReference) {
    provider = customProviders.find((candidate) => providerHasModelReference(candidate, modelReference)
      || (isCopilotProvider(candidate) && baseModelReference(modelReference) === `${candidate.id}/auto`));
    if (!provider && modelReference.includes("/")) {
      return {
        ok: false,
        reason: "unknown-provider",
        message: `The selected model "${modelReference}" is no longer available from a configured provider. Choose a model from the current list.`,
      };
    }
  }
  if (!provider) {
    const active = customProviders.find((candidate) => candidate.id === activeCustomProviderId);
    if (active && modelReference && isManagedAuthProvider(active)
      && !active.models.some((model) => model.remoteId === baseModelReference(modelReference))
      && !(isCopilotProvider(active) && baseModelReference(modelReference) === "auto")) {
      return {
        ok: false,
        reason: "unknown-provider",
        message: `The selected model "${modelReference}" is not available from ${active.name}. Choose one of its current models.`,
      };
    }
    provider = active;
  }

  if (!provider) {
    return modelReference
      ? {
          ok: false,
          reason: "unknown-provider",
          message: `No configured provider owns the model "${modelReference}".`,
        }
      : { ok: false, reason: "no-model-selected", message: "No model is selected." };
  }

  if (isManagedAuthProvider(provider)) {
    const kind = providerStatusOrUnknown(providerStatus, provider.id).kind;
    if (kind === "unknown" || kind === "loading") {
      return {
        ok: false,
        reason: "status-pending",
        message: `Still checking ${provider.name}'s status -- try again in a moment.`,
      };
    }
    if (kind !== "ready") {
      return {
        ok: false,
        reason: "not-authenticated",
        message: `Sign in to ${provider.name} before running this.`,
      };
    }
  }

  return { ok: true, provider };
}
