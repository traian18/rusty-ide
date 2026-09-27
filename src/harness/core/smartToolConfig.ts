import type { SmartToolSettings } from "../../store/smartReadTypes";
import type { CustomProvider, ProviderStatus } from "../../store/types";
import { providerHasModelReference, selectableModelProviders } from "../../store/providerHelpers";

/** The selector model a smart tool uses for one run, resolved once at the
 * run boundary together with that tool's mode. */
export interface SelectorModelConfig {
  providerId: string;
  modelId: string;
  provider?: CustomProvider;
}

export interface SmartToolSettingsSources {
  providers: CustomProvider[];
  providerStatus: Record<string, ProviderStatus>;
  activeProviderId: string | null;
}

/** The global smart-tool settings as plain data, captured by whoever starts a
 * run (never read from the store by harness code). The harness validates and
 * resolves it once per run in `ensureSmartToolConfigs`. */
export interface SmartToolSettingsSnapshot extends SmartToolSettingsSources {
  read: SmartToolSettings;
  search: SmartToolSettings;
  webExtract: SmartToolSettings;
}

declare module "../../harness/contract/capabilities" {
  interface AgentChatInput {
    smartToolSettings?: SmartToolSettingsSnapshot;
  }
  interface ExecuteNodeInput {
    smartToolSettings?: SmartToolSettingsSnapshot;
  }
}

/** `undefined` when the tool is disabled; throws an actionable error when it
 * is enabled without a usable selector, so the run never starts half-configured. */
export function resolveSelectorModel(
  settings: SmartToolSettings,
  sources: SmartToolSettingsSources,
  featureName: string,
): SelectorModelConfig | undefined {
  if (!settings.enabled) return undefined;
  const feature = featureName.charAt(0).toUpperCase() + featureName.slice(1);
  if (!settings.providerId || !settings.modelId) {
    throw new Error(`${feature} is enabled, but no selector model is configured. Choose a provider and model or disable ${featureName}.`);
  }
  const selectableProviders = selectableModelProviders(sources.providers, sources.providerStatus, sources.activeProviderId);
  const provider = selectableProviders.find((candidate) => candidate.id === settings.providerId);
  if (!provider || !providerHasModelReference(provider, settings.modelId)) {
    throw new Error(`${feature} is enabled, but the configured selector model is unavailable. Choose a valid provider and model or disable ${featureName}.`);
  }
  return { providerId: settings.providerId, modelId: settings.modelId, provider };
}
