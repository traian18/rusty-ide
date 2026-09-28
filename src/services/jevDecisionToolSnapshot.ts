import type { DecideStepUpConfig, DecideToolRunConfig, JevRiskReviewRunConfig } from "../harness/core/decideToolConfig";
import type { WorkspaceState } from "../store/types";
import { findOpenRouterJevProvider, openRouterModelId, resolveOpenRouterJevModel } from "./intelligentModelSelector";

/** Captures the `decide` tool's JEV connection a run starts with; `undefined`
 * (tool not offered) when it is off or OpenRouter/JEV is unavailable. Call it
 * where the run is started, so settings changed mid-run only affect the next run. */
export function snapshotJevDecisionTool(state: WorkspaceState, stepUp?: DecideStepUpConfig): DecideToolRunConfig | undefined {
  const settings = state.intelligentModelSelectionSettings;
  if (!settings.decisionToolEnabled) return undefined;
  const provider = findOpenRouterJevProvider(state.customProviders, settings.jevModelId);
  const model = resolveOpenRouterJevModel(provider, settings.jevModelId);
  const apiKey = provider?.apiKey?.trim();
  if (!model || !apiKey) return undefined;
  return {
    apiKey,
    jevModelId: openRouterModelId(model),
    proceedConfidence: settings.decisionConfidenceThreshold,
    ...(stepUp ? { stepUp } : {}),
  };
}

/** Captures the risky-action review's JEV connection a run starts with;
 * `undefined` (no review) when it is off or OpenRouter/JEV is unavailable. */
export function snapshotJevRiskReview(state: WorkspaceState): JevRiskReviewRunConfig | undefined {
  const settings = state.intelligentModelSelectionSettings;
  if (!settings.riskReviewEnabled) return undefined;
  const provider = findOpenRouterJevProvider(state.customProviders, settings.jevModelId);
  const model = resolveOpenRouterJevModel(provider, settings.jevModelId);
  const apiKey = provider?.apiKey?.trim();
  if (!model || !apiKey) return undefined;
  return { apiKey, jevModelId: openRouterModelId(model), proceedConfidence: settings.decisionConfidenceThreshold };
}
