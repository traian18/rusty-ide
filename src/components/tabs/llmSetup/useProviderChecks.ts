import { useState } from "react";
import { useWorkspaceStore, type CustomProvider } from "../../../store";
import { notify } from "../../../notificationStore";
import { hybridControlPlane as controlPlane } from "../../../harness/HybridControlPlane";
import { providerModelVariants } from "../../../store/providerHelpers";
import {
  checkFailed,
  checkSucceeded,
  mergeDiscoveredModels,
  modelsRefreshedMessage,
  replacementActiveModel,
} from "./providerChecks";

/** Catalogue refresh and connection test. Both run against the draft, so unsaved edits are what get checked. */
export function useProviderChecks(draft: CustomProvider) {
  const activeModel = useWorkspaceStore((state) => state.activeModel);
  const setActiveModel = useWorkspaceStore((state) => state.setActiveModel);
  const updateProviderSettings = useWorkspaceStore((state) => state.updateProviderSettings);
  const [fetchingModels, setFetchingModels] = useState(false);
  const [testingConnection, setTestingConnection] = useState(false);

  const fetchModels = async () => {
    setFetchingModels(true);
    try {
      const models = mergeDiscoveredModels(await controlPlane.discoverModels(draft), draft.models);
      const supported = models.filter((model) => model.supported !== false);
      updateProviderSettings(draft.id, {
        ...draft,
        models,
        modelsFetchedAt: new Date().toISOString(),
        executionStatus: checkSucceeded(draft, "catalog"),
      });
      const replacement = replacementActiveModel(supported.flatMap(providerModelVariants), activeModel);
      if (replacement) setActiveModel(replacement);
      notify("Models refreshed", modelsRefreshedMessage(supported.length, models.length - supported.length), supported.length ? "success" : "info");
    } catch (err: any) {
      updateProviderSettings(draft.id, { ...draft, executionStatus: checkFailed(draft, "catalog", err.message) });
      notify("Fetch failed", `Failed to fetch models: ${err.message}`, "error");
    } finally {
      setFetchingModels(false);
    }
  };

  const testConnection = async () => {
    setTestingConnection(true);
    try {
      const result = await controlPlane.testConnection(draft);
      updateProviderSettings(draft.id, { ...draft, executionStatus: checkSucceeded(draft, "inference") });
      notify("Connection successful", `${draft.name} returned ${result.modelCount} models; ${result.supportedModelCount} are supported by Rusty.`, "success");
    } catch (err: any) {
      updateProviderSettings(draft.id, { ...draft, executionStatus: checkFailed(draft, "inference", err.message) });
      notify("Connection failed", err.message || "Could not connect to the provider.", "error");
    } finally {
      setTestingConnection(false);
    }
  };

  return { fetchingModels, testingConnection, busy: fetchingModels || testingConnection, fetchModels, testConnection };
}

export type ProviderChecks = ReturnType<typeof useProviderChecks>;
