import { hybridControlPlane as controlPlane } from "../harness/HybridControlPlane";
import { useWorkspaceStore } from "../store";
import type { CustomProvider, ProviderModel } from "../store/types";

const updatesInFlight = new Map<string, Promise<ProviderModel[]>>();

function mergeDiscoveredModels(provider: CustomProvider, discoveredModels: ProviderModel[]): ProviderModel[] {
  return discoveredModels.map((model) => {
    const previous = provider.models.find((candidate) => candidate.id === model.id)
      || provider.models.find((candidate) =>
        (candidate.remoteId || candidate.id) === (model.remoteId || model.id)
      );
    return { ...previous, ...model };
  });
}

/**
 * Refreshes one provider in the persisted model catalogue. Concurrent
 * requests for the same provider share one network call, so multiple open
 * model pickers cannot cause a request burst.
 */
export function updateModelCatalogue(provider: CustomProvider): Promise<ProviderModel[]> {
  const existing = updatesInFlight.get(provider.id);
  if (existing) return existing;

  const update: Promise<ProviderModel[]> = controlPlane.discoverModels(provider)
    .then((discoveredModels) => {
      const currentProvider = useWorkspaceStore.getState().customProviders
        .find((candidate) => candidate.id === provider.id) || provider;
      const models = mergeDiscoveredModels(currentProvider, discoveredModels);
      useWorkspaceStore.getState().updateProviderSettings(provider.id, {
        models,
        modelsFetchedAt: new Date().toISOString(),
      });
      return models;
    })
    .finally(() => {
      if (updatesInFlight.get(provider.id) === update) {
        updatesInFlight.delete(provider.id);
      }
    });

  updatesInFlight.set(provider.id, update);
  return update;
}

export function providerCatalogueSignature(provider: CustomProvider): string {
  return JSON.stringify([
    provider.apiKey?.trim() || "",
    provider.baseUrl?.trim() || "",
    provider.catalogUrl?.trim() || "",
    provider.apiType || "",
    provider.authType || "",
    provider.transport || "",
  ]);
}
