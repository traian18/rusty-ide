import React, { useEffect } from "react";
import { useWorkspaceStore, CustomProvider } from "../../store";
import { Cpu } from "lucide-react";
import { ProviderList, selectFirstSupportedModel } from "./llmSetup/ProviderList";
import { ConnectServicePanel } from "./llmSetup/ConnectServicePanel";
import { ProviderDetails } from "./llmSetup/ProviderDetails";

/** With no model chosen yet, default to the selected provider's first supported one. */
function useDefaultActiveModel(provider: CustomProvider | undefined) {
  const activeModel = useWorkspaceStore((state) => state.activeModel);
  const setActiveModel = useWorkspaceStore((state) => state.setActiveModel);

  useEffect(() => {
    if (activeModel || !provider) return;
    const modelId = selectFirstSupportedModel(provider);
    if (modelId) setActiveModel(modelId);
  }, [activeModel, provider, setActiveModel]);
}

export const LlmSetupTab: React.FC = () => {
  const customProviders = useWorkspaceStore((state) => state.customProviders);
  const activeCustomProviderId = useWorkspaceStore((state) => state.activeCustomProviderId);
  const setActiveCustomProviderId = useWorkspaceStore((state) => state.setActiveCustomProviderId);
  const setActiveModel = useWorkspaceStore((state) => state.setActiveModel);
  const providerStatus = useWorkspaceStore((state) => state.providerStatus);
  const selectedProvider = customProviders.find((p) => p.id === activeCustomProviderId);
  useDefaultActiveModel(selectedProvider);

  return (
    <div className="w-full h-full p-8 max-w-5xl mx-auto flex flex-col space-y-6 font-sans text-[var(--text-normal)] overflow-y-auto">
      <div className="flex flex-col space-y-1">
        <h2 className="text-2xl font-bold text-[var(--text-light)] flex items-center space-x-2">
          <Cpu className="text-[var(--accent-color)]" size={24} />
          <span>LLM Connection Center</span>
        </h2>
        <p className="text-xs text-[var(--text-muted)] font-mono">
          Manage API credentials, target models, and local inference server endpoints.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-5 gap-8">
        <div className="md:col-span-2 space-y-4">
          <ProviderList
            providers={customProviders}
            activeProviderId={activeCustomProviderId}
            connectionStatuses={{}}
            providerStatus={providerStatus}
            onSelectProvider={(provider) => {
              setActiveCustomProviderId(provider.id);
              const modelId = selectFirstSupportedModel(provider);
              if (modelId) setActiveModel(modelId);
            }}
          />
          <ConnectServicePanel />
        </div>

        <div className="md:col-span-3">
          {selectedProvider ? (
            <ProviderDetails provider={selectedProvider} />
          ) : (
            <div className="bg-[var(--bg-sidebar)] border border-[var(--border-color)] rounded-2xl p-8 text-center flex flex-col items-center justify-center min-h-[300px]">
              <Cpu size={40} className="text-[var(--text-muted)] opacity-30 mb-3" />
              <span className="text-sm font-bold text-[var(--text-light)] font-mono">No Active Provider Selected</span>
              <p className="text-xs text-[var(--text-muted)] max-w-sm mt-1">Select an LLM Integration provider from the sidebar menu to edit credentials, URLs, and customize models.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
