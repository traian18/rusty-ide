import { setToolDecisionObserver } from "../harness/core/toolDecisionObserver";
import { executionObservability } from "../observability/executionStore";
import { useWorkspaceStore } from "../store";
import { findOpenRouterJevProvider, openRouterModelId, resolveOpenRouterJevModel } from "./intelligentModelSelector";
import { JevShadowGate, type JevShadowConfig } from "./jevShadowGate";
import { jevShadowStats } from "./jevShadowStats";

/** Settings are read per tool call, so turning the gate on or off applies from the next call. */
function currentConfig(): JevShadowConfig | undefined {
  const state = useWorkspaceStore.getState();
  const settings = state.intelligentModelSelectionSettings;
  if (!settings.decisionShadowEnabled) return undefined;
  const provider = findOpenRouterJevProvider(state.customProviders, settings.jevModelId);
  const model = resolveOpenRouterJevModel(provider, settings.jevModelId);
  const apiKey = provider?.apiKey?.trim();
  if (!model || !apiKey) return undefined;
  return { apiKey, jevModelId: openRouterModelId(model) };
}

export function installJevShadowGate(): void {
  setToolDecisionObserver(new JevShadowGate({
    config: currentConfig,
    stats: jevShadowStats,
    record: (runId, sessionId, callId, level, message, details) =>
      executionObservability.toolObserver(runId, sessionId, callId).step(level, message, details),
  }));
}
