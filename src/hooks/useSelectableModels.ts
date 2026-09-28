import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CustomProvider, ProviderStatus } from "../store/types";
import {
  isManagedAuthProvider,
  selectableProviderModels,
} from "../store/providerHelpers";
import { providerStatusOrUnknown } from "../integrations/registryTypes";
import {
  providerCatalogueSignature,
  updateModelCatalogue,
} from "../services/modelCatalogueService";

export interface SelectableModelOption {
  id: string;
  name: string;
}

export interface SelectableModelsResult {
  options: SelectableModelOption[];
  /** Managed providers excluded because their registry status isn't
      'ready' yet -- lets a picker render a helpful "Sign in to X"
      placeholder instead of silently omitting their models with no
      explanation (REFACTOR_PLAN.md PR 3c). */
  unauthenticatedProviders: CustomProvider[];
  refreshCatalogue: () => Promise<void>;
  isRefreshingCatalogue: boolean;
}

export function buildSelectableModels(
  customProviders: CustomProvider[],
  providerStatus: Record<string, ProviderStatus>,
  selectedProviderId: string | null,
): Omit<SelectableModelsResult, "refreshCatalogue" | "isRefreshingCatalogue"> {
  const options = selectableProviderModels(customProviders, providerStatus, selectedProviderId)
    .map(({ provider, model }) => ({ id: model.id, name: `${provider.name} / ${model.name}` }));

  const unauthenticatedProviders = customProviders.filter(
    (provider) =>
      isManagedAuthProvider(provider)
      && providerStatusOrUnknown(providerStatus, provider.id).kind !== "ready",
  );

  return { options, unauthenticatedProviders };
}

function canUpdateCatalogue(
  provider: CustomProvider,
  providerStatus: Record<string, ProviderStatus>,
): boolean {
  if (isManagedAuthProvider(provider)) {
    return providerStatusOrUnknown(providerStatus, provider.id).kind === "ready";
  }
  return provider.authType === "none" || Boolean(provider.apiKey?.trim());
}

/**
 * Reads model options from the shared persisted catalogue and keeps that
 * catalogue synchronized whenever an integration's connection settings
 * change. The returned refresh function is intended for picker-open events;
 * callers always continue rendering the latest store-backed options while
 * the network update is in flight.
 */
export function useSelectableModels(
  customProviders: CustomProvider[],
  providerStatus: Record<string, ProviderStatus>,
  selectedProviderId: string | null,
): SelectableModelsResult {
  const [isRefreshingCatalogue, setIsRefreshingCatalogue] = useState(false);
  const selectable = useMemo(
    () => buildSelectableModels(customProviders, providerStatus, selectedProviderId),
    [customProviders, providerStatus, selectedProviderId],
  );

  const providersToUpdate = useMemo(
    () => customProviders.filter((provider) => canUpdateCatalogue(provider, providerStatus)),
    [customProviders, providerStatus],
  );
  const providersToUpdateRef = useRef(providersToUpdate);
  providersToUpdateRef.current = providersToUpdate;

  const refreshCatalogue = useCallback(async () => {
    const providers = providersToUpdateRef.current;
    if (providers.length === 0) return;
    setIsRefreshingCatalogue(true);
    try {
      await Promise.all(providers.map((provider) => updateModelCatalogue(provider)));
    } finally {
      setIsRefreshingCatalogue(false);
    }
  }, []);

  const integrationSignature = useMemo(
    () => providersToUpdate
      .map((provider) => `${provider.id}:${providerCatalogueSignature(provider)}`)
      .sort()
      .join("|"),
    [providersToUpdate],
  );

  useEffect(() => {
    if (!integrationSignature) return;
    void refreshCatalogue().catch((error) => {
      console.error("Could not update the model catalogue after an integration change:", error);
    });
  }, [integrationSignature, refreshCatalogue]);

  return { ...selectable, refreshCatalogue, isRefreshingCatalogue };
}
