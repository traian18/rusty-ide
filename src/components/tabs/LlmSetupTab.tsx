import React, { useState, useEffect, useCallback } from "react";
import { useWorkspaceStore, CustomProvider, ProviderModel } from "../../store";
import { Cpu, Key, Globe, Plus, ShieldCheck, Save, Layers, Lock, Unlock, HelpCircle as HelpIcon, RefreshCw, Copy, ExternalLink, Tag, Hash, Settings, Package, XCircle, PlusCircle, AlertTriangle } from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { CustomSelect } from "../CustomSelect";
import { notify } from "../../notificationStore";
import { hybridControlPlane as controlPlane } from "../../harness/HybridControlPlane";
import {
  isCodexProvider,
  isCopilotProvider,
  isManagedAuthProvider as isManagedAuthProviderPredicate,
  providerModelVariants,
} from "../../store/providerHelpers";
import { providerStatusOrUnknown } from "../../integrations/registryTypes";
import { cancelManagedLogin, logoutManaged, startManagedLogin } from "../shell/providerCoordinator";
import { ProviderList, selectFirstSupportedModel } from "./llmSetup/ProviderList";
import { providerHelpText } from "./llmSetup/providerHelp";
import { validateProviderConfig, ProviderConfigValidationResult } from "../../integrations/providerConnectionValidation";
import { ProviderHeader } from "../../store/types";



const AUTH_TYPE_OPTIONS = [
  { id: "none", name: "None / Local" },
  { id: "bearer", name: "Bearer token" },
  { id: "anthropic", name: "Anthropic x-api-key" },
];

const API_PROTOCOL_OPTIONS = [
  { id: "openai-completions", name: "OpenAI Chat Completions" },
  { id: "openai-responses", name: "OpenAI Responses" },
  { id: "anthropic-messages", name: "Anthropic Messages" },
  // "google-generative-ai" is explicitly not supported for direct execution currently
];

export const LlmSetupTab: React.FC = () => {
  const customProviders = useWorkspaceStore((state) => state.customProviders);
  const activeCustomProviderId = useWorkspaceStore((state) => state.activeCustomProviderId);
  const activeModel = useWorkspaceStore((state) => state.activeModel);
  const setActiveCustomProviderId = useWorkspaceStore((state) => state.setActiveCustomProviderId);
  const setActiveModel = useWorkspaceStore((state) => state.setActiveModel);
  const updateProviderSettings = useWorkspaceStore((state) => state.updateProviderSettings);
  const addCustomProvider = useWorkspaceStore((state) => state.addCustomProvider);
  const providerStatus = useWorkspaceStore((state) => state.providerStatus);


  const [editedProvider, setEditedProvider] = useState<CustomProvider | null>(null);
  const [showKey, setShowKey] = useState(false);
  const [validationResult, setValidationResult] = useState<ProviderConfigValidationResult>({ valid: true, warnings: [] });
  const [fetchingModels, setFetchingModels] = useState(false);
  const [testingConnection, setTestingConnection] = useState(false);

  const selectedProvider = customProviders.find((p) => p.id === activeCustomProviderId);
  const isCopilot = Boolean(selectedProvider && isCopilotProvider(selectedProvider));
  const isCodex = Boolean(selectedProvider && isCodexProvider(selectedProvider));
  const isManagedAuthProvider = Boolean(selectedProvider && isManagedAuthProviderPredicate(selectedProvider));
  const managedStatus = selectedProvider ? providerStatusOrUnknown(providerStatus, selectedProvider.id) : undefined;
  const managedVendor = isCodex ? "OpenAI" : "GitHub";
  const managedProduct = isCodex ? "Codex" : "Copilot";



  useEffect(() => {
    if (selectedProvider) {
      setEditedProvider(selectedProvider);
      setShowKey(false);
    }
  }, [selectedProvider]);

  useEffect(() => {
    if (editedProvider) {
      setValidationResult(validateProviderConfig({
        baseUrl: editedProvider.baseUrl || "",
        catalogUrl: editedProvider.catalogUrl || undefined,
        authType: editedProvider.authType || "none",
        apiKey: editedProvider.apiKey || undefined,
        headers: editedProvider.headers,
        // requiresApiKey is determined by the profile but handled within validateProviderConfig
      }));
    }
  }, [editedProvider]);

  useEffect(() => {
    if (!activeModel && selectedProvider && selectedProvider.models.length > 0) {
      const firstSupportedModel = selectedProvider.models.find((model) => model.supported !== false);
      if (firstSupportedModel) setActiveModel(providerModelVariants(firstSupportedModel)[0].id);
    }
  }, [activeModel, selectedProvider, setActiveModel]);

  const addHeader = useCallback(() => {
    setEditedProvider(prev => {
      if (!prev) return null;
      const newHeaders = [...(prev.headers || []), { name: "", value: "", secret: false }];
      return { ...prev, headers: newHeaders };
    });
  }, []);

  const updateHeader = useCallback((index: number, field: keyof ProviderHeader, value: any) => {
    setEditedProvider(prev => {
      if (!prev || !prev.headers) return prev;
      const newHeaders = [...prev.headers];
      newHeaders[index] = { ...newHeaders[index], [field]: value };
      return { ...prev, headers: newHeaders };
    });
  }, []);

  const removeHeader = useCallback((index: number) => {
    setEditedProvider(prev => {
      if (!prev || !prev.headers) return prev;
      const newHeaders = prev.headers.filter((_, i) => i !== index);
      return { ...prev, headers: newHeaders };
    });
  }, []);

  const getAuthPlaceholder = (authType?: string) => {
    switch (authType) {
      case "none": return "This provider does not require a key";
      case "bearer": return "Enter your Bearer Token";
      case "anthropic": return "Enter your x-api-key";
      case "github": return "GitHub PAT with models:read scope (or use GITHUB_TOKEN)";
      default: return "Enter your API Key / Auth Token";
    }
  };

  const getPresetApiTypeOptions = useCallback(() => {
    return API_PROTOCOL_OPTIONS;
  }, []);


  useEffect(() => {
    if (!activeModel && selectedProvider && selectedProvider.models.length > 0) {
      const firstSupportedModel = selectedProvider.models.find((model) => model.supported !== false);
      if (firstSupportedModel) setActiveModel(providerModelVariants(firstSupportedModel)[0].id);
    }
  }, [activeModel, selectedProvider, setActiveModel]);



  const handleSaveSettings = () => {
    if (!editedProvider || !validationResult.valid) return;
    updateProviderSettings(editedProvider.id, editedProvider);
    notify("Saved", `Connection settings updated for ${editedProvider.name}.`, "success");
  };

  const handleFetchModels = async () => {
    if (!editedProvider) return;

    setFetchingModels(true);
    try {
      const discoveredModels = await controlPlane.discoverModels(editedProvider);
      const models = discoveredModels.map((model) => {
        const previous = editedProvider.models?.find((candidate) => candidate.id === model.id)
          || editedProvider.models?.find((candidate) =>
            (candidate.remoteId || candidate.id) === (model.remoteId || model.id)
          );
        return { ...previous, ...model };
      });
      const supportedModels = models.filter((model) => model.supported !== false);
      const selectableModels = supportedModels.flatMap(providerModelVariants);
      updateProviderSettings(editedProvider.id, {
        ...editedProvider,
        models,
        modelsFetchedAt: new Date().toISOString(),
        executionStatus: { ...editedProvider.executionStatus, catalog: { status: 'success', testedAt: new Date().toISOString() } },
      });
      if (selectableModels.length > 0 && !selectableModels.some((model) => model.id === activeModel)) {
        setActiveModel(selectableModels[0].id);
      }
      // setConnectionStatus({ ...connectionStatus, [editedProvider.id]: "connected" }); // Removed
      const unsupportedCount = models.length - supportedModels.length;
      notify(
        "Models refreshed",
        `Loaded ${supportedModels.length} supported model${supportedModels.length === 1 ? "" : "s"}${unsupportedCount ? `; ${unsupportedCount} unsupported catalog entries were disabled` : ""}.`,
        supportedModels.length ? "success" : "info"
      );
    } catch (err: any) {
      // setConnectionStatus({ ...connectionStatus, [editedProvider.id]: "failed" }); // Removed
      updateProviderSettings(editedProvider.id, {
        ...editedProvider,
        executionStatus: { ...editedProvider.executionStatus, catalog: { status: 'failed', testedAt: new Date().toISOString(), message: err.message } },
      });
      notify("Fetch failed", `Failed to fetch models: ${err.message}`, "error");
    } finally {
      setFetchingModels(false);
    }
  };

  const handleTestConnection = async () => {
    if (!editedProvider) return;
    setTestingConnection(true);
    try {
      const result = await controlPlane.testConnection(editedProvider);
      // setConnectionStatus({ ...connectionStatus, [editedProvider.id]: "connected" }); // Removed
      updateProviderSettings(editedProvider.id, {
        ...editedProvider,
        executionStatus: { ...editedProvider.executionStatus, inference: { status: 'success', testedAt: new Date().toISOString() } },
      });
      notify("Connection successful", `${editedProvider.name} returned ${result.modelCount} models; ${result.supportedModelCount} are supported by Rusty.`, "success");
    } catch (err: any) {
      // setConnectionStatus({ ...connectionStatus, [editedProvider.id]: "failed" }); // Removed
      updateProviderSettings(editedProvider.id, {
        ...editedProvider,
        executionStatus: { ...editedProvider.executionStatus, inference: { status: 'failed', testedAt: new Date().toISOString(), message: err.message } },
      });
      notify("Connection failed", err.message || "Could not connect to the provider.", "error");
    } finally {
      setTestingConnection(false);
    }
  };

  const handleManagedLogin = async () => {
    if (!selectedProvider) return;
    try {
      await startManagedLogin(selectedProvider);
    } catch (error: any) {
      notify("Sign-in failed", error?.message || `Could not start ${managedVendor} authorization.`, "error");
    }
  };

  const handleManagedLogout = async () => {
    if (!selectedProvider) return;
    try {
      await logoutManaged(selectedProvider);
      notify("Signed out", `Disconnected the ${managedVendor} account from ${managedProduct}.`, "success");
    } catch (error: any) {
      notify("Sign-out failed", error?.message || `Could not sign out of ${managedProduct}.`, "error");
    }
  };

  const [cancellingLogin, setCancellingLogin] = useState(false);

  const handleCancelManagedLogin = async () => {
    if (!selectedProvider) return;
    setCancellingLogin(true);
    try {
      await cancelManagedLogin(selectedProvider);
      notify("Sign-in cancelled", `Cancelled ${managedVendor} sign-in attempt.`, "info");
    } catch (error: any) {
      notify("Cancel failed", error?.message || `Could not cancel ${managedVendor} sign-in.`, "error");
    } finally {
      setCancellingLogin(false);
    }
  };

  const handleCopyManagedCode = async () => {
    if (!managedStatus?.userCode) return;
    try {
      await navigator.clipboard.writeText(managedStatus.userCode);
      notify("Code copied", `The ${managedVendor} device code was copied to your clipboard.`, "success");
    } catch (error: any) {
      notify("Copy failed", error?.message || "Could not copy the device code.", "error");
    }
  };

  const managedVerificationFallback = isCodex
    ? "https://auth.openai.com/codex/device"
    : isCopilot
      ? "https://github.com/login/device"
      : undefined;

  const handleOpenManagedVerification = async () => {
    const verificationUri = managedStatus?.verificationUri || managedVerificationFallback;
    if (!verificationUri) return;
    try {
      await openUrl(verificationUri);
    } catch (error: any) {
      notify(`Could not open ${managedVendor}`, error?.message || `Open ${verificationUri} in your browser.`, "error");
    }
  };

  const handleCopyManagedDiagnostics = async () => {
    if (!managedStatus?.diagnostics?.length) return;
    try {
      await navigator.clipboard.writeText(managedStatus.diagnostics.join("\n"));
      notify("Diagnostics copied", `Paste these redacted ${managedProduct} authentication logs into the issue or chat.`, "success");
    } catch (error: any) {
      notify("Copy failed", error?.message || "Could not copy the authentication diagnostics.", "error");
    }
  };

  const [showAddCustom, setShowAddCustom] = useState(false);
  const [provPreset, setProvPreset] = useState<'openai' | 'openai-compatible' | 'ollama' | 'vllm' | 'openrouter' | 'opencode-zen'>('openai-compatible');
  const [provName, setProvName] = useState("");
  const [provUrl, setProvUrl] = useState("");
  const [provApiKey, setProvApiKey] = useState("");
  const [provModel, setProvModel] = useState("");
  const [provDiscoverAfterSave, setProvDiscoverAfterSave] = useState(false);

  const handleAddNewProvider = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!provName.trim()) {
      notify("Display name required", "Enter a display name for this service", "error");
      return;
    }

    if (!provUrl.trim()) {
      notify("Base URL required", "Enter the provider's API base URL", "error");
      return;
    }

    const { getPreset } = await import("../../integrations/providerConnectionProfiles");
    const { validateProviderConfig } = await import("../../integrations/providerConnectionValidation");

    const preset = getPreset(provPreset);

    // Validate the configuration
    const validation = validateProviderConfig({
      baseUrl: provUrl.trim(),
      authType: preset.authType,
      apiKey: provApiKey,
      requiresApiKey: preset.authType === 'bearer',
    });

    if (!validation.valid) {
      const errors = [
        validation.baseUrlError,
        validation.catalogUrlError,
        validation.authenticationError,
      ].filter(Boolean).join("; ");
      notify("Configuration invalid", errors, "error");
      return;
    }

    // Show warning if applicable
    validation.warnings.forEach(w => {
      notify("Warning", w);
    });

    // Generate provider ID from name
    let providerId = provName.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
    if (!providerId) providerId = `provider-${Date.now()}`;

    // Ensure unique
    let uniqueId = providerId;
    let counter = 1;
    while (customProviders.some((p) => p.id === uniqueId)) {
      uniqueId = `${providerId}-${counter}`;
      counter++;
    }

    // Build models array
    const modelsList: ProviderModel[] = [];
    if (provModel.trim()) {
      modelsList.push({
        id: `${uniqueId}/${provModel.trim()}`,
        remoteId: provModel.trim(),
        name: provModel.trim().split("/").pop() || provModel.trim(),
        apiType: preset.apiType,
        baseUrl: provUrl.trim(),
        supported: true,
      });
    }

    // Create the provider with profile metadata
    const newProvider: CustomProvider = {
      id: uniqueId,
      name: provName.trim(),
      baseUrl: provUrl.trim(),
      apiKey: provApiKey,
      apiType: preset.apiType,
      authType: preset.authType,
      models: modelsList,
      profile: preset.profile,
      // Enable tools by default for known presets; custom providers default to disabled
      capabilities: { tools: ['openai', 'openai-compatible', 'ollama', 'vllm', 'openrouter', 'opencode-zen'].includes(provPreset) ? 'enabled' : 'disabled' },
    };

    addCustomProvider(newProvider);
    setActiveCustomProviderId(newProvider.id);
    if (modelsList.length > 0) setActiveModel(modelsList[0].id);

    notify("Saved", `Provider ${provName} saved successfully!`, "success");

    // Reset form
    setProvPreset("openai-compatible");
    setProvName("");
    setProvUrl("");
    setProvApiKey("");
    setProvModel("");
    setProvDiscoverAfterSave(false);
    setShowAddCustom(false);

    // Optionally trigger discovery
    if (provDiscoverAfterSave) {
      // This will be implemented in later task for discovery
      console.log("Discovery after save would be triggered here");
    }
  };

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

          {!showAddCustom ? (
            <button
              id="llm-register-custom-provider-button"
              type="button"
              onClick={() => setShowAddCustom(true)}
              className="w-full border border-dashed border-[var(--border-color)] hover:border-[var(--accent-color)] hover:bg-[var(--accent-bg)]/5 text-xs text-[var(--text-muted)] hover:text-[var(--text-light)] font-mono font-semibold py-3 rounded-xl transition-all flex items-center justify-center space-x-1.5 cursor-pointer"
            >
              <Plus size={14} className="text-[var(--accent-color)]" />
              <span>Connect an Inference Service</span>
            </button>
          ) : (
            <form
              onSubmit={handleAddNewProvider}
              className="bg-[var(--bg-sidebar)] border border-[var(--border-color)] rounded-xl p-4 space-y-3 font-sans"
            >
              <div className="flex items-center justify-between border-b border-[var(--border-color)]/30 pb-2">
                <span className="text-xs font-bold text-[var(--text-light)] font-mono">Connect Service</span>
                <button id="llm-cancel-custom-provider-button" type="button" onClick={() => setShowAddCustom(false)} className="text-[var(--color-status-danger)] hover:text-[var(--color-status-danger)] text-[10px] font-mono cursor-pointer">Cancel</button>
              </div>

              <div className="space-y-2 text-xs">
                <div className="space-y-1">
                  <label htmlFor="llm-service-preset" className="block text-[9px] uppercase font-bold text-[var(--text-muted)] font-mono">
                    Service Type
                  </label>
                  <CustomSelect
                    id="llm-service-preset"
                    options={[
                      { id: "openai-compatible", name: "OpenAI-Compatible API" },
                      { id: "ollama", name: "Ollama" },
                      { id: "vllm", name: "vLLM" },
                      { id: "openrouter", name: "OpenRouter" },
                      { id: "opencode-zen", name: "OpenCode Zen" },
                      { id: "openai", name: "OpenAI" },
                    ]}
                    value={provPreset}
                    onChange={(value) => {
                      setProvPreset(value as any);
                      // Update defaults based on preset
                      const { getPreset } = require("../../integrations/providerConnectionProfiles");
                      const preset = getPreset(value);
                      setProvUrl(preset.defaultBaseUrl);
                      setProvName(preset.defaultDisplayName);
                    }}
                  />
                </div>

                <div className="space-y-1">
                  <label htmlFor="llm-custom-provider-name" className="block text-[9px] uppercase font-bold text-[var(--text-muted)] font-mono">
                    Display Name
                  </label>
                  <input
                    id="llm-custom-provider-name"
                    type="text"
                    placeholder="e.g. My Ollama Server"
                    value={provName}
                    onChange={(e) => setProvName(e.target.value)}
                    className="w-full bg-[var(--bg-app)] border border-[var(--border-color)] rounded-lg p-2 text-xs text-[var(--text-light)] focus:outline-none focus:border-[var(--border-active)]"
                    required
                  />
                </div>

                <div className="space-y-1">
                  <label htmlFor="llm-custom-provider-url" className="block text-[9px] uppercase font-bold text-[var(--text-muted)] font-mono">
                    Base API URL
                  </label>
                  <input
                    id="llm-custom-provider-url"
                    type="text"
                    placeholder="e.g. http://localhost:11434/v1"
                    value={provUrl}
                    onChange={(e) => setProvUrl(e.target.value)}
                    className="w-full bg-[var(--bg-app)] border border-[var(--border-color)] rounded-lg p-2 text-xs font-mono text-[var(--text-light)] focus:outline-none focus:border-[var(--border-active)]"
                    required
                  />
                </div>

                <div className="space-y-1">
                  <label htmlFor="llm-api-key" className="block text-[9px] uppercase font-bold text-[var(--text-muted)] font-mono">
                    API Key (Optional)
                  </label>
                  <input
                    id="llm-api-key"
                    type="password"
                    placeholder="Leave blank if not required"
                    value={provApiKey}
                    onChange={(e) => setProvApiKey(e.target.value)}
                    className="w-full bg-[var(--bg-app)] border border-[var(--border-color)] rounded-lg p-2 text-xs font-mono text-[var(--text-light)] focus:outline-none focus:border-[var(--border-active)]"
                  />
                </div>

                <div className="space-y-1">
                  <label htmlFor="llm-model-id" className="block text-[9px] uppercase font-bold text-[var(--text-muted)] font-mono">
                    Model ID (Optional)
                  </label>
                  <input
                    id="llm-model-id"
                    type="text"
                    placeholder="e.g. gpt-4, llama2, or leave empty to discover later"
                    value={provModel}
                    onChange={(e) => setProvModel(e.target.value)}
                    className="w-full bg-[var(--bg-app)] border border-[var(--border-color)] rounded-lg p-2 text-xs font-mono text-[var(--text-light)] focus:outline-none focus:border-[var(--border-active)]"
                  />
                </div>

                <div className="flex items-center space-x-2">
                  <input
                    id="llm-discover-after-save"
                    type="checkbox"
                    checked={provDiscoverAfterSave}
                    onChange={(e) => setProvDiscoverAfterSave(e.target.checked)}
                    className="w-4 h-4 rounded border-[var(--border-color)] cursor-pointer"
                  />
                  <label htmlFor="llm-discover-after-save" className="text-[9px] text-[var(--text-muted)] cursor-pointer">
                    Discover available models after save
                  </label>
                </div>

                <button
                  id="llm-submit-custom-provider-button"
                  type="submit"
                  className="w-full bg-[var(--accent-color)] hover:bg-[var(--accent-color)]/85 text-[var(--color-primary-foreground)] font-mono font-bold py-2 rounded-lg text-xs transition-all shadow-md cursor-pointer flex items-center justify-center space-x-1.5"
                >
                  <Plus size={13} />
                  <span>Save Configuration</span>
                </button>
              </div>
            </form>
          )}
        </div>

        <div className="md:col-span-3">
          {selectedProvider ? (
            <div className="bg-[var(--bg-sidebar)] border border-[var(--border-color)] rounded-2xl p-6 space-y-6">
              <div className="flex items-center justify-between border-b border-[var(--border-color)]/30 pb-4">
                <div className="flex flex-col">
                  <span className="text-[10px] uppercase font-bold text-[var(--text-muted)] font-mono tracking-wider">Provider Configuration</span>
                  <span className="text-lg font-bold text-[var(--text-light)]">{selectedProvider.name} Settings</span>
                </div>
                <div className="flex items-center space-x-1 bg-[var(--bg-app)] border border-[var(--border-color)] rounded-full px-3 py-1 font-mono text-[10px] text-[var(--text-muted)]">
                  <span>ID:</span><span className="font-bold text-[var(--text-light)]">{selectedProvider.id}</span>
                </div>
              </div>

              <div className="space-y-4 text-xs">
                {isManagedAuthProvider ? (
                  <div className="space-y-4 rounded-xl border border-[var(--border-color)] bg-[var(--bg-app)]/60 p-4">
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex items-start gap-3">
                        <div className={`mt-0.5 h-2.5 w-2.5 flex-shrink-0 rounded-full ${managedStatus?.kind === "ready" ? "bg-[var(--color-status-success)]" : managedStatus?.kind === "loading" ? "bg-[var(--color-status-warning)] animate-pulse" : "bg-[var(--text-muted)]"}`} />
                        <div className="space-y-1">
                          <div className="font-mono text-xs font-bold text-[var(--text-light)]">
                            {managedStatus?.kind === "loading" ? `Connecting to ${managedVendor}` : managedStatus?.kind === "ready" ? `Connected${managedStatus.account ? ` as ${managedStatus.account}` : ""}` : `${managedVendor} sign-in required`}
                          </div>
                          <p className="text-[10px] leading-relaxed text-[var(--text-muted)]">{managedStatus?.message || (isCodex ? "Use the OpenAI account connected to your Codex plan." : "Use the GitHub account that owns your Copilot subscription.")}</p>
                          <p className="text-[10px] leading-relaxed text-[var(--text-muted)]">The first sign-in downloads this integration’s runtime. Other integrations are downloaded only when you use them.</p>
                          {isCopilot && managedStatus?.host && <p className="font-mono text-[9px] text-[var(--text-muted)]">{managedStatus.host}</p>}
                          {isCodex && managedStatus?.planType && <p className="font-mono text-[9px] text-[var(--text-muted)]">Plan: {managedStatus.planType}</p>}
                        </div>
                      </div>
                      <div className="flex flex-shrink-0 items-center gap-2">
                        {managedStatus?.kind === "ready" && (
                          <button id="llm-managed-sign-out-button" type="button" onClick={() => void handleManagedLogout()} className="whitespace-nowrap rounded-lg border border-[var(--border-color)] bg-[var(--bg-app)] px-3 py-2 font-mono text-[10px] font-bold text-[var(--text-normal)] transition-colors hover:border-[var(--color-status-danger)] hover:text-[var(--color-status-danger)] disabled:cursor-not-allowed disabled:opacity-50">Sign Out</button>
                        )}
                        {managedStatus?.kind === "loading" && (
                          <button id="llm-cancel-managed-login-button" type="button" onClick={() => void handleCancelManagedLogin()} disabled={cancellingLogin} className="whitespace-nowrap rounded-lg border border-[var(--border-color)] bg-[var(--bg-app)] px-3 py-2 font-mono text-[10px] font-bold text-[var(--text-muted)] transition-colors hover:border-[var(--color-status-danger)] hover:text-[var(--color-status-danger)] disabled:cursor-not-allowed disabled:opacity-50">{cancellingLogin ? "Cancelling…" : "Cancel"}</button>
                        )}
                        <button id="llm-managed-sign-in-button" type="button" onClick={() => void handleManagedLogin()} disabled={managedStatus?.kind === "loading"} className="whitespace-nowrap rounded-lg bg-[var(--accent-color)] px-3 py-2 font-mono text-[10px] font-bold text-[var(--color-primary-foreground)] transition-opacity disabled:cursor-not-allowed disabled:opacity-50">
                          {managedStatus?.kind === "loading" ? "Signing in…" : managedStatus?.kind === "ready" ? "Re-authenticate" : `Sign in with ${managedVendor}`}
                        </button>
                      </div>
                    </div>
                    {managedStatus?.kind === "loading" && (managedStatus.userCode || managedStatus.verificationUri) && (
                      <div className="rounded-xl border border-[var(--accent-color)]/40 bg-[var(--accent-bg)]/10 p-4 text-center">
                        <div className="text-[9px] font-bold uppercase tracking-[0.2em] text-[var(--text-muted)]">{managedStatus.userCode ? `${managedVendor} device code` : `Waiting for ${managedVendor} sign-in`}</div>
                        {managedStatus.userCode ? (
                          <button id="llm-copy-managed-code-value-button" type="button" onClick={handleCopyManagedCode} className="mt-2 font-mono text-2xl font-bold tracking-[0.18em] text-[var(--text-light)] hover:text-[var(--accent-color)]" title="Copy device code">{managedStatus.userCode}</button>
                        ) : (
                          <p className="mt-2 font-mono text-[10px] text-[var(--text-normal)]">A browser window should have opened. If it didn&apos;t, open the sign-in page below.</p>
                        )}
                        <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
                          {managedStatus.userCode && <button id="llm-copy-managed-code-button" type="button" onClick={handleCopyManagedCode} className="flex items-center gap-1.5 rounded-lg border border-[var(--border-color)] bg-[var(--bg-app)] px-3 py-2 font-mono text-[10px] font-bold text-[var(--text-normal)] hover:border-[var(--accent-color)] hover:text-[var(--text-light)]"><Copy size={12} /><span>Copy Code</span></button>}
                          {(managedStatus.verificationUri || managedVerificationFallback) && <button id="llm-open-managed-verification-button" type="button" onClick={handleOpenManagedVerification} className="flex items-center gap-1.5 rounded-lg bg-[var(--accent-color)] px-3 py-2 font-mono text-[10px] font-bold text-[var(--color-primary-foreground)] hover:opacity-90"><ExternalLink size={12} /><span>Open {managedVendor}</span></button>}
                        </div>
                        <p className="mt-2 break-all font-mono text-[9px] text-[var(--text-muted)]">{managedStatus.verificationUri || managedVerificationFallback || "Waiting for the sign-in page…"}</p>
                      </div>
                    )}
                    {Boolean(managedStatus?.diagnostics?.length) && (
                      <details className="rounded-lg border border-[var(--border-color)]/60 bg-[var(--bg-app)]/60 p-3">
                        <summary className="cursor-pointer font-mono text-[10px] font-bold text-[var(--text-normal)]">Authentication diagnostics</summary>
                        <pre className="mt-3 max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-[var(--bg-app)] p-2 font-mono text-[9px] leading-relaxed text-[var(--text-muted)]">{managedStatus?.diagnostics?.join("\n")}</pre>
                        <button id="llm-copy-managed-diagnostics-button" type="button" onClick={handleCopyManagedDiagnostics} className="mt-2 flex items-center gap-1.5 rounded-lg border border-[var(--border-color)] px-2.5 py-1.5 font-mono text-[9px] font-bold text-[var(--text-normal)] hover:border-[var(--accent-color)] hover:text-[var(--text-light)]"><Copy size={11} /><span>Copy Diagnostics</span></button>
                      </details>
                    )}
                    <div className="border-t border-[var(--border-color)]/50 pt-3 text-[10px] leading-relaxed text-[var(--text-muted)]">
                      {isCodex ? "The official Codex app-server manages credentials in the same ~/.codex account used by Codex CLI/Desktop. Rusty never stores the OAuth token in provider settings." : "GitHub Copilot CLI manages credentials, using the system credential store when available. Rusty never stores the OAuth token in provider settings."}
                    </div>
                  </div>
                ) : (

                  <>
                    {/* Basic Settings - Always Visible */}
                    <div className="space-y-2">
                      <label htmlFor="llm-provider-name" className="block text-xs font-bold text-[var(--text-normal)] uppercase font-mono tracking-wide flex items-center space-x-1.5">
                        <Tag size={13} className="text-[var(--color-secondary)]" />
                        <span>Display Name</span>
                      </label>
                      <input
                        id="llm-provider-name"
                        type="text"
                        placeholder="My Custom LLM"
                        value={editedProvider?.name || ""}
                        onChange={(e) => setEditedProvider(prev => prev ? { ...prev, name: e.target.value } : prev)}
                        className="w-full bg-[var(--bg-app)] border border-[var(--border-color)] rounded-xl px-3.5 py-2.5 text-xs text-[var(--text-light)] font-mono focus:outline-none focus:border-[var(--border-active)] placeholder-[var(--text-muted)]/70 shadow-inner"
                      />
                    </div>

                    <div className="space-y-2">
                      <label htmlFor="llm-provider-base-url" className="block text-xs font-bold text-[var(--text-normal)] uppercase font-mono tracking-wide flex items-center space-x-1.5">
                        <Globe size={13} className="text-[var(--color-secondary)]" />
                        <span>Connection Base URL</span>
                      </label>
                      <input
                        id="llm-provider-base-url"
                        type="text"
                        placeholder="e.g. https://api.openai.com/v1"
                        value={editedProvider?.baseUrl || ""}
                        onChange={(e) => setEditedProvider(prev => prev ? { ...prev, baseUrl: e.target.value } : prev)}
                        className="w-full bg-[var(--bg-app)] border border-[var(--border-color)] rounded-xl px-3.5 py-2.5 text-xs text-[var(--text-light)] font-mono focus:outline-none focus:border-[var(--border-active)] placeholder-[var(--text-muted)]/70 shadow-inner"
                      />
                      {validationResult.warnings.map((warning, idx) => (
                        <span key={idx} className="text-[10px] text-[var(--color-status-warning)] leading-relaxed italic block mt-1 font-mono flex items-center space-x-1">
                          <AlertTriangle size={10} className="flex-shrink-0" /><span>{warning}</span>
                        </span>
                      ))}
                    </div>

                    <div className="space-y-2">
                      <div className="flex justify-between items-center">
                        <label htmlFor="llm-provider-api-key" className="block text-xs font-bold text-[var(--text-normal)] uppercase font-mono tracking-wide flex items-center space-x-1.5">
                          <Key size={13} className="text-[var(--color-secondary)]" />
                          <span>API Authorization Key</span>
                        </label>
                        {editedProvider?.authType !== "none" && (
                          <button
                            id="llm-toggle-api-key-visibility-button"
                            type="button"
                            onClick={() => setShowKey(!showKey)}
                            className="text-[10px] text-[var(--text-muted)] hover:text-[var(--text-light)] transition-colors cursor-pointer flex items-center space-x-1 font-mono"
                          >
                            {showKey ? <><Lock size={10} /><span>Hide</span></> : <><Unlock size={10} /><span>Show</span></>}
                          </button>
                        )}
                      </div>
                      <input
                        id="llm-provider-api-key"
                        type={showKey ? "text" : "password"}
                        placeholder={getAuthPlaceholder(editedProvider?.authType)}
                        value={editedProvider?.apiKey || ""}
                        onChange={(e) => setEditedProvider(prev => prev ? { ...prev, apiKey: e.target.value } : prev)}
                        disabled={editedProvider?.authType === "none"}
                        className="w-full bg-[var(--bg-app)] border border-[var(--border-color)] rounded-xl px-3.5 py-2.5 text-xs text-[var(--text-light)] font-mono focus:outline-none focus:border-[var(--border-active)] placeholder-[var(--text-muted)]/70 shadow-inner disabled:opacity-50 disabled:cursor-not-allowed"
                      />
                      {editedProvider?.id === "openai" && !editedProvider?.apiKey && (
                        <span className="text-[10px] text-[var(--text-muted)] leading-relaxed italic block mt-1 font-mono">ℹ Environment Variable configuration will be active for this provider since no custom key is provided.</span>
                      )}
                    </div>

                    {/* Advanced Settings */}
                    <details className="rounded-xl border border-[var(--border-color)]/60 bg-[var(--bg-app)]/60 p-3 mt-4">
                      <summary className="cursor-pointer font-mono text-[10px] font-bold text-[var(--text-normal)] uppercase tracking-wide flex items-center space-x-1.5">
                        <Settings size={13} className="text-[var(--color-secondary)]" />
                        <span>Advanced Settings</span>
                      </summary>
                      <div className="space-y-4 pt-4">
                        <div className="space-y-2">
                          <label htmlFor="llm-provider-id" className="block text-xs font-bold text-[var(--text-normal)] uppercase font-mono tracking-wide flex items-center space-x-1.5">
                            <Hash size={13} className="text-[var(--color-secondary)]" />
                            <span>Provider ID</span>
                          </label>
                          <input
                            id="llm-provider-id"
                            type="text"
                            placeholder="unique-provider-id"
                            value={editedProvider?.id || ""}
                            onChange={(e) => setEditedProvider(prev => prev ? { ...prev, id: e.target.value } : prev)}
                            className="w-full bg-[var(--bg-app)] border border-[var(--border-color)] rounded-xl px-3.5 py-2.5 text-xs text-[var(--text-light)] font-mono focus:outline-none focus:border-[var(--border-active)] placeholder-[var(--text-muted)]/70 shadow-inner"
                          />
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            <div className="space-y-2">
                                <label className="block text-xs font-bold text-[var(--text-normal)] uppercase font-mono tracking-wide">
                                    Default API Protocol
                                </label>
                                <CustomSelect
                                    value={editedProvider?.apiType || ""}
                                    onChange={(value) => setEditedProvider(prev => prev ? { ...prev, apiType: value } : prev)}
                                    options={getPresetApiTypeOptions()}
                                />
                            </div>
                            <div className="space-y-2">
                                <label className="block text-xs font-bold text-[var(--text-normal)] uppercase font-mono tracking-wide">
                                    Authentication
                                </label>
                                <CustomSelect
                                    value={editedProvider?.authType || ""}
                                    onChange={(value) => setEditedProvider(prev => prev ? { ...prev, authType: value as any } : prev)}
                                    options={AUTH_TYPE_OPTIONS}
                                />
                            </div>
                        </div>
                        <div className="space-y-2">
                          <label htmlFor="llm-provider-catalog-url" className="block text-xs font-bold text-[var(--text-normal)] uppercase font-mono tracking-wide flex items-center space-x-1.5">
                            <Layers size={13} className="text-[var(--color-secondary)]" />
                            <span>Model Catalog URL</span>
                          </label>
                          <input
                            id="llm-provider-catalog-url"
                            type="text"
                            placeholder="Defaults to the base URL plus /models"
                            value={editedProvider?.catalogUrl || ""}
                            onChange={(e) => setEditedProvider(prev => prev ? { ...prev, catalogUrl: e.target.value } : prev)}
                            className="w-full bg-[var(--bg-app)] border border-[var(--border-color)] rounded-xl px-3.5 py-2.5 text-xs text-[var(--text-light)] font-mono focus:outline-none focus:border-[var(--border-active)] placeholder-[var(--text-muted)]/70 shadow-inner"
                          />
                        </div>
                        {/* Provider Headers */}
                        <div className="space-y-2">
                          <label className="block text-xs font-bold text-[var(--text-normal)] uppercase font-mono tracking-wide flex items-center space-x-1.5">
                            <Package size={13} className="text-[var(--color-secondary)]" />
                            <span>Custom Headers</span>
                          </label>
                          {editedProvider?.headers?.map((header, idx) => (
                            <div key={idx} className="flex items-center gap-2">
                              <input
                                type="text"
                                placeholder="Header-Name"
                                value={header.name}
                                onChange={(e) => updateHeader(idx, "name", e.target.value)}
                                className="w-1/2 bg-[var(--bg-app)] border border-[var(--border-color)] rounded-xl px-3.5 py-2.5 text-xs text-[var(--text-light)] font-mono focus:outline-none focus:border-[var(--border-active)] placeholder-[var(--text-muted)]/70 shadow-inner"
                              />
                              <input
                                type={header.secret ? "password" : "text"}
                                placeholder="Header-Value"
                                value={header.value}
                                onChange={(e) => updateHeader(idx, "value", e.target.value)}
                                className="w-1/2 bg-[var(--bg-app)] border border-[var(--border-color)] rounded-xl px-3.5 py-2.5 text-xs text-[var(--text-light)] font-mono focus:outline-none focus:border-[var(--border-active)] placeholder-[var(--text-muted)]/70 shadow-inner"
                              />
                              <input
                                type="checkbox"
                                checked={header.secret}
                                onChange={(e) => updateHeader(idx, "secret", e.target.checked)}
                                className="h-4 w-4 rounded border-gray-300 text-[var(--accent-color)] focus:ring-[var(--accent-color)]"
                                title="Mark as secret"
                              />
                              <button
                                type="button"
                                onClick={() => removeHeader(idx)}
                                className="text-[var(--color-status-danger)] hover:text-[var(--color-status-danger)]/80 transition-colors"
                                title="Remove header"
                              >
                                <XCircle size={16} />
                              </button>
                            </div>
                          ))}
                          <button
                            type="button"
                            onClick={addHeader}
                            className="flex items-center gap-1.5 rounded-lg border border-[var(--border-color)] bg-[var(--bg-app)] px-3 py-2 font-mono text-[10px] font-bold text-[var(--text-normal)] hover:border-[var(--accent-color)] hover:text-[var(--text-light)]"
                          >
                            <PlusCircle size={13} />
                            <span>Add Custom Header</span>
                          </button>
                        </div>

                        {/* Capabilities */}
                        <div className="space-y-2">
                          <label className="block text-xs font-bold text-[var(--text-normal)] uppercase font-mono tracking-wide flex items-center space-x-1.5">
                            <Cpu size={13} className="text-[var(--color-secondary)]" />
                            <span>Capabilities</span>
                          </label>
                          <div className="flex items-center gap-2">
                            <input
                              type="checkbox"
                              id="llm-capability-tools"
                              checked={editedProvider?.capabilities?.tools === "enabled"}
                              onChange={(e) => setEditedProvider(prev => prev ? {
                                ...prev,
                                capabilities: { ...prev.capabilities, tools: e.target.checked ? "enabled" : "disabled" }
                              } : prev)}
                              className="h-4 w-4 rounded border-gray-300 text-[var(--accent-color)] focus:ring-[var(--accent-color)]"
                            />
                            <label htmlFor="llm-capability-tools" className="text-sm text-[var(--text-normal)]">
                              Enable Tool Calling (requires OpenAI-compatible tools support)
                            </label>
                          </div>
                          {editedProvider?.capabilities?.tools === "disabled" && (
                            <span className="text-[10px] text-[var(--text-muted)] leading-relaxed italic block mt-1 font-mono">
                              Tool calling is disabled by default for custom providers. Enable after confirming model supports OpenAI-compatible tools.
                            </span>
                          )}
                        </div>
                      </div>
                    </details>
                  </>

                )}

                <div className="space-y-2 pt-2">
                  <label className="block text-xs font-bold text-[var(--text-normal)] uppercase font-mono tracking-wide flex items-center space-x-1.5"><Layers size={13} className="text-[var(--color-secondary)]" /><span>Default Target Model</span></label>
                  <CustomSelect
                    value={activeModel}
                    onChange={setActiveModel}
                    options={selectedProvider.models.length > 0 ? selectedProvider.models.filter((model) => model.supported !== false).flatMap(providerModelVariants).map((m) => ({ id: m.id, name: `${m.name} (${m.remoteId || m.id})` })) : []}
                    placeholder={isManagedAuthProvider && managedStatus?.kind !== "ready" ? `Sign in with ${managedVendor} to load ${managedProduct} models` : "No supported models available - update the provider catalogue"}
                  />
                  {selectedProvider.models.some((model) => providerModelVariants(model).length > 1) && <span className="text-[10px] text-[var(--text-muted)] font-mono">Reasoning-capable models are listed once per supported effort; the selected effort is sent with every request.</span>}
                  {selectedProvider.models.some((model) => model.supported === false) && <span className="text-[10px] text-[var(--text-muted)] font-mono">{selectedProvider.models.filter((model) => model.supported === false).length} catalog entries are hidden because their protocol or tool capabilities are not supported.</span>}
                </div>

                <div className="pt-4 flex flex-col space-y-3.5 border-t border-[var(--border-color)]/30">
                  <div className="flex flex-wrap items-center gap-2">
                    <button id="llm-update-model-catalogue-button" type="button" onClick={handleFetchModels} disabled={fetchingModels || testingConnection || (isManagedAuthProvider && managedStatus?.kind !== "ready")} className="whitespace-nowrap border border-[var(--border-color)] hover:border-[var(--accent-color)] bg-[var(--bg-app)] hover:bg-[var(--accent-bg)]/10 text-[var(--text-normal)] hover:text-[var(--text-light)] font-mono font-bold px-4 py-2.5 rounded-xl transition-all cursor-pointer flex items-center space-x-1.5 disabled:opacity-50" title="Discover and update the provider's shared model catalogue">
                      <RefreshCw size={13} className={fetchingModels ? "animate-spin text-[var(--accent-color)]" : ""} /><span>{fetchingModels ? "Updating..." : "Update Model Catalogue"}</span>
                    </button>
                    <button id="llm-test-connection-button" type="button" onClick={handleTestConnection} disabled={fetchingModels || testingConnection || (isManagedAuthProvider && managedStatus?.kind !== "ready")} className="whitespace-nowrap border border-[var(--border-color)] hover:border-[var(--color-status-success-border)] bg-[var(--bg-app)] hover:bg-[var(--color-status-success-bg)] text-[var(--text-normal)] hover:text-[var(--text-light)] font-mono font-bold px-4 py-2.5 rounded-xl transition-all cursor-pointer flex items-center space-x-1.5 disabled:opacity-50">
                      <ShieldCheck size={13} className={testingConnection ? "animate-pulse text-[var(--color-status-success)]" : ""} /><span>{testingConnection ? "Testing..." : "Test"}</span>
                    </button>
                    {!isManagedAuthProvider && <button id="llm-save-configuration-button" type="button" onClick={handleSaveSettings} disabled={!editedProvider || !validationResult.valid || fetchingModels || testingConnection} className="whitespace-nowrap bg-[var(--accent-color)] hover:bg-[var(--accent-color)]/85 text-[var(--color-primary-foreground)] font-mono font-bold px-4 py-2.5 rounded-xl transition-all shadow-lg hover:shadow-[var(--accent-color)]/20 cursor-pointer flex items-center space-x-1.5"><Save size={13} /><span>Save Configuration</span></button>}
                  </div>
                  {editedProvider && (
                    <div className="flex items-center space-x-1.5 text-[10px] font-mono text-[var(--text-muted)] bg-[var(--bg-app)]/50 border border-[var(--border-color)]/40 rounded-lg px-2.5 py-1.5 w-fit">
                      <ShieldCheck size={14} className="text-[var(--color-status-success)]" />
                      <span>Active Model: {activeModel || "None selected"}</span>
                    </div>
                  )}
                </div>
              </div>

              <div className="bg-[var(--bg-app)] border border-[var(--border-color)] rounded-xl p-4.5 flex items-start space-x-3.5">
                <HelpIcon size={18} className="text-[var(--accent-color)] flex-shrink-0 mt-0.5" />
                <div className="flex flex-col space-y-1"><span className="text-xs font-bold text-[var(--text-light)]">Integration Guide</span><p className="text-[11px] text-[var(--text-muted)] leading-relaxed font-sans">{providerHelpText(selectedProvider.id)}</p></div>
              </div>
            </div>
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
