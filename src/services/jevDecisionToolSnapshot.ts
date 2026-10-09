import type { ContextCompactionRunConfig, DecideStepUpConfig, DecideToolRunConfig, FlowRouterRunConfig, JevRiskReviewRunConfig, StepModelRunConfig } from "../harness/core/decideToolConfig";
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

/** Captures how a run compacts long conversations. Always present: the
 * default is local compaction. `smart` is used only when its setting is on and
 * OpenRouter/JEV is available, the same check as the other JEV features, and
 * otherwise falls back to the default. */
export function snapshotContextCompaction(state: WorkspaceState): ContextCompactionRunConfig {
  const settings = state.intelligentModelSelectionSettings;
  if (!settings.smartContextCompactionEnabled) return { mode: "standard" };
  const provider = findOpenRouterJevProvider(state.customProviders, settings.jevModelId);
  const model = resolveOpenRouterJevModel(provider, settings.jevModelId);
  const apiKey = provider?.apiKey?.trim();
  if (!model || !apiKey) return { mode: "standard" };
  return { mode: "smart", jev: { apiKey, jevModelId: openRouterModelId(model), confidence: settings.decisionConfidenceThreshold } };
}

/** Captures the JEV connection and level-to-model mapping a workflow run uses
 * to choose a model for each step; `undefined` when OpenRouter/JEV is
 * unavailable. Call it where the run is started. */
export function snapshotStepModels(state: WorkspaceState, levels: StepModelRunConfig["levels"]): StepModelRunConfig | undefined {
  const settings = state.intelligentModelSelectionSettings;
  const provider = findOpenRouterJevProvider(state.customProviders, settings.jevModelId);
  const model = resolveOpenRouterJevModel(provider, settings.jevModelId);
  const apiKey = provider?.apiKey?.trim();
  if (!model || !apiKey) return undefined;
  return { apiKey, jevModelId: openRouterModelId(model), levels };
}

/** Captures the JEV connection the flow router uses (choosing a workflow for a
 * message, and handing a running one over at a step boundary); `undefined`
 * when OpenRouter/JEV is unavailable. Call it where the run is started. */
export function snapshotFlowRouter(state: WorkspaceState): FlowRouterRunConfig | undefined {
  const settings = state.intelligentModelSelectionSettings;
  const provider = findOpenRouterJevProvider(state.customProviders, settings.jevModelId);
  const model = resolveOpenRouterJevModel(provider, settings.jevModelId);
  const apiKey = provider?.apiKey?.trim();
  if (!model || !apiKey) return undefined;
  return { apiKey, jevModelId: openRouterModelId(model), proceedConfidence: settings.decisionConfidenceThreshold };
}
