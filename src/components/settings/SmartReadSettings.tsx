import React from "react";
import { FileSearch, Globe, ScanSearch, type LucideIcon } from "lucide-react";
import { CustomSelect } from "../CustomSelect";
import { useWorkspaceStore } from "../../store";
import { providerModelVariants, selectableModelProviders } from "../../store/providerHelpers";
import type { SmartToolSettings } from "../../store/smartReadTypes";

interface SmartToolSettingsCardProps {
  idPrefix: string;
  icon: LucideIcon;
  title: string;
  description: string;
  settings: SmartToolSettings;
  updateSettings: (settings: Partial<SmartToolSettings>) => void;
}

const SmartToolSettingsCard: React.FC<SmartToolSettingsCardProps> = ({ idPrefix, icon: Icon, title, description, settings, updateSettings }) => {
  const providers = useWorkspaceStore((state) => state.customProviders);
  const providerStatus = useWorkspaceStore((state) => state.providerStatus);
  const activeProviderId = useWorkspaceStore((state) => state.activeCustomProviderId);

  const selectableProviders = selectableModelProviders(providers, providerStatus, activeProviderId)
    .filter((provider) => provider.models.some((model) => model.supported !== false));
  const selectedProvider = selectableProviders.find((provider) => provider.id === settings.providerId) || selectableProviders[0];
  const modelOptions = selectedProvider
    ? selectedProvider.models
        .filter((model) => model.supported !== false)
        .flatMap(providerModelVariants)
        .map((model) => ({ id: model.id, name: `${model.name} (${model.remoteId || model.id})` }))
    : [];
  const canEnable = Boolean(settings.providerId && settings.modelId && modelOptions.some((model) => model.id === settings.modelId));

  const setProvider = (providerId: string) => {
    const provider = selectableProviders.find((candidate) => candidate.id === providerId);
    const firstModel = provider?.models.filter((model) => model.supported !== false).flatMap(providerModelVariants)[0]?.id || null;
    updateSettings({ providerId, modelId: firstModel, enabled: Boolean(firstModel) && settings.enabled });
  };

  const setEnabled = (enabled: boolean) => {
    updateSettings({ enabled: enabled && canEnable });
  };

  return (
    <section className="rounded-2xl border border-[var(--border-color)] bg-[var(--bg-sidebar)] p-5 shadow-sm space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="rounded-xl bg-[var(--accent-bg)]/20 p-2 text-[var(--accent-color)]">
            <Icon size={18} />
          </div>
          <div>
            <h3 className="text-sm font-bold text-[var(--text-light)]">{title}</h3>
            <p className="mt-1 text-[11px] leading-relaxed text-[var(--text-muted)]">
              {description} The configuration is captured when a run starts and remains unchanged until that run finishes.
            </p>
          </div>
        </div>
        <label htmlFor={`${idPrefix}-enabled`} className="flex items-center gap-2 text-[10px] font-mono font-bold uppercase text-[var(--text-muted)]">
          <input
            id={`${idPrefix}-enabled`}
            type="checkbox"
            checked={settings.enabled}
            disabled={!canEnable}
            onChange={(event) => setEnabled(event.target.checked)}
            className="h-4 w-4 accent-[var(--accent-color)]"
          />
          Enabled
        </label>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <label htmlFor={`${idPrefix}-provider`} className="block text-[10px] font-mono font-bold uppercase text-[var(--text-muted)]">Selector provider</label>
          <CustomSelect
            id={`${idPrefix}-provider`}
            value={settings.providerId || ""}
            onChange={setProvider}
            options={selectableProviders.map((provider) => ({ id: provider.id, name: provider.name }))}
            placeholder="Choose provider"
          />
        </div>
        <div className="space-y-1.5">
          <label htmlFor={`${idPrefix}-model`} className="block text-[10px] font-mono font-bold uppercase text-[var(--text-muted)]">Selector model</label>
          <CustomSelect
            id={`${idPrefix}-model`}
            value={settings.modelId || ""}
            onChange={(modelId) => updateSettings({ modelId })}
            options={modelOptions}
            placeholder={selectedProvider ? "Choose model" : "Choose a provider first"}
          />
        </div>
      </div>

      {!canEnable && (
        <p className="rounded-lg border border-[var(--color-status-warning-border)] bg-[var(--color-status-warning-bg)] px-3 py-2 text-[10px] text-[var(--text-normal)]">
          Choose an available provider and model before enabling {title.toLowerCase()}.
        </p>
      )}
    </section>
  );
};

export const SmartReadSettings: React.FC = () => {
  const settings = useWorkspaceStore((state) => state.smartReadSettings);
  const updateSettings = useWorkspaceStore((state) => state.updateSmartReadSettings);
  return (
    <SmartToolSettingsCard
      idPrefix="smart-read"
      icon={FileSearch}
      title="Smart file reading"
      description="Smart file reading returns only the relevant portions of a file based on your request."
      settings={settings}
      updateSettings={updateSettings}
    />
  );
};

export const SmartSearchSettings: React.FC = () => {
  const settings = useWorkspaceStore((state) => state.smartSearchSettings);
  const updateSettings = useWorkspaceStore((state) => state.updateSmartSearchSettings);
  return (
    <SmartToolSettingsCard
      idPrefix="smart-search"
      icon={ScanSearch}
      title="Smart code search"
      description="Smart code search finds the most relevant matches for a described need and returns a ranked, size-limited list of file locations."
      settings={settings}
      updateSettings={updateSettings}
    />
  );
};

export const SmartWebExtractSettings: React.FC = () => {
  const settings = useWorkspaceStore((state) => state.smartWebExtractSettings);
  const updateSettings = useWorkspaceStore((state) => state.updateSmartWebExtractSettings);
  return (
    <SmartToolSettingsCard
      idPrefix="smart-web-extract"
      icon={Globe}
      title="Smart web extraction"
      description="Adds a web_extract tool that returns only the sections of a web page relevant to a question, quoted verbatim with the source URL. Full-page web_fetch stays available."
      settings={settings}
      updateSettings={updateSettings}
    />
  );
};
