import React, { useMemo } from "react";
import { CheckCircle2, CircleAlert, Sparkles } from "lucide-react";
import { CustomSelect } from "../CustomSelect";
import { useWorkspaceStore } from "../../store";
import { AutoLevelModelsField } from "./AutoLevelModelsField";
import {
  AUTO_LEVEL_LABELS,
  buildIntelligentCandidates,
  findOpenRouterJevModels,
  isJevDecisionModelId,
  isJevFamilyModelId,
  resolveLevelCandidates,
  resolveOpenRouterJevModel,
} from "../../services/intelligentModelSelector";
import styles from "./IntelligentModelSelectionSettings.module.css";

function remoteModelId(model: { id: string; remoteId?: string }): string {
  const id = model.remoteId || model.id;
  return id.startsWith("openrouter/") ? id.slice("openrouter/".length) : id;
}

export const IntelligentModelSelectionSettings: React.FC = () => {
  const settings = useWorkspaceStore((state) => state.intelligentModelSelectionSettings);
  const updateSettings = useWorkspaceStore((state) => state.updateIntelligentModelSelectionSettings);
  const providers = useWorkspaceStore((state) => state.customProviders);
  const providerStatus = useWorkspaceStore((state) => state.providerStatus);
  const activeProviderId = useWorkspaceStore((state) => state.activeCustomProviderId);
  const openRouter = providers.find((provider) => provider.id === "openrouter");
  const hasApiKey = Boolean(openRouter?.apiKey?.trim());
  const jevModels = findOpenRouterJevModels(openRouter);
  const selectedJevModel = resolveOpenRouterJevModel(openRouter, settings.jevModelId);
  const selectedJevModelId = selectedJevModel ? remoteModelId(selectedJevModel) : "";
  const availableCandidates = useMemo(
    () => buildIntelligentCandidates(providers, providerStatus, activeProviderId),
    [activeProviderId, providerStatus, providers],
  );
  const { missing: missingLevels } = resolveLevelCandidates(
    providers,
    providerStatus,
    activeProviderId,
    settings.levelModels,
  );
  const hasJev = hasApiKey && Boolean(selectedJevModel);
  const isAvailable = hasJev && missingLevels.length === 0;
  const chatModelCount = openRouter?.models.filter((model) =>
    model.supported !== false && !isJevDecisionModelId(remoteModelId(model))
  ).length || 0;
  const jevFamilyCount = openRouter?.models.filter((model) => isJevFamilyModelId(remoteModelId(model))).length || 0;
  const otherHiddenCount = Math.max(
    0,
    (openRouter?.models.length || 0) - chatModelCount - jevModels.length,
  );

  const setEnabled = (enabled: boolean) => {
    updateSettings({
      enabled: enabled && isAvailable,
      jevModelId: selectedJevModelId || settings.jevModelId,
    });
  };

  return (
    <section className={styles.section} aria-labelledby="intelligent-model-selection-title">
      <div className={styles.heading}>
        <div className={styles.headingCopy}>
          <div className={styles.titleRow}>
            <Sparkles aria-hidden="true" size={16} />
            <h3 className={styles.title} id="intelligent-model-selection-title">Intelligent model selection</h3>
          </div>
          <p className={styles.description}>
            Adds AUTO to the Agent model picker. A JEV Decisions API model rates how demanding each request is, and the model you set for that level runs it.
          </p>
        </div>
        <label className={styles.toggleLabel} htmlFor="intelligent-model-selection-enabled">
          <input
            className={styles.toggleInput}
            id="intelligent-model-selection-enabled"
            type="checkbox"
            checked={settings.enabled && isAvailable}
            disabled={!isAvailable}
            onChange={(event) => setEnabled(event.target.checked)}
          />
          <span className={styles.toggleTrack} aria-hidden="true"><span /></span>
          <span>Enabled</span>
        </label>
      </div>

      <div className={styles.catalogSummary} aria-label="OpenRouter model book summary">
        <div className={styles.summaryItem}>
          <span className={styles.summaryValue}>{openRouter?.models.length || 0}</span>
          <span>catalog entries</span>
        </div>
        <div className={styles.summaryItem}>
          <span className={styles.summaryValue}>{chatModelCount}</span>
          <span>chat models</span>
        </div>
        <div className={styles.summaryItem}>
          <span className={styles.summaryValue}>{jevModels.length}</span>
          <span>JEV decision models</span>
        </div>
        {otherHiddenCount > 0 && (
          <div className={styles.summaryItem}>
            <span className={styles.summaryValue}>{otherHiddenCount}</span>
            <span>other non-chat entries</span>
          </div>
        )}
      </div>

      {jevModels.length > 0 && (
        <div className={styles.field}>
          <label className={styles.fieldLabel} htmlFor="intelligent-model-selection-jev-model">JEV decision model</label>
          <CustomSelect
            id="intelligent-model-selection-jev-model"
            value={selectedJevModelId}
            onChange={(jevModelId) => updateSettings({ jevModelId })}
            options={jevModels.map((model) => {
              const id = remoteModelId(model);
              return { id, name: `${model.name} (${id})` };
            })}
            placeholder="Choose a JEV version"
          />
          <p className={styles.fieldHint}>
            All compatible JEV versions and aliases from your authenticated OpenRouter model book are shown. Jev Router remains a chat model; it is not used for Decisions API calls.
          </p>
        </div>
      )}

      {hasJev && (
        <AutoLevelModelsField
          available={availableCandidates}
          levelModels={settings.levelModels}
          onChange={(level, candidateId) => updateSettings({
            levelModels: { ...settings.levelModels, [level]: candidateId },
          })}
        />
      )}

      {isAvailable ? (
        <div className={styles.statusSuccess} role="status">
          <CheckCircle2 aria-hidden="true" size={14} />
          <span>Ready: <strong>{selectedJevModelId}</strong> rates each request as Light, Standard, or Heavy.</span>
        </div>
      ) : (
        <div className={styles.statusWarning} role="status">
          <CircleAlert aria-hidden="true" size={14} />
          <span>
            {!hasApiKey
              ? "Connect OpenRouter with an API key to enable intelligent model selection."
              : !selectedJevModel
                ? jevFamilyCount > 0
                  ? "Only Jev Router was found. Refresh the authenticated OpenRouter model book to load a JEV Decisions API version or latest alias."
                  : "Refresh the authenticated OpenRouter model book; at least one TypeSafe JEV Decisions API model must be available."
                : `Choose an available model for ${missingLevels.map((level) => AUTO_LEVEL_LABELS[level]).join(", ")} to enable intelligent model selection.`}
          </span>
        </div>
      )}
    </section>
  );
};
