import { useWorkspaceStore } from "../../../store";
import { hybridControlPlane as controlPlane } from "../../../harness/HybridControlPlane";
import { createSemaphore } from "../integrations/concurrency";
import { DISCOVERY_CONCURRENCY, isCatalogStale, isEligibleForDiscovery } from "../integrations/discoveryPolicy";
import { providerStatusOrUnknown } from "../integrations/registryTypes";
import { refreshModelLimits } from "../modelLimits";
import { MANAGED_PROVIDER_IDS, isManagedProviderId } from "./managedStatus";
import type { CustomProvider } from "../../../store/types";

/** Whether the coordinator is running; discovery does nothing while it is stopped. */
let active = false;

export function setDiscoveryActive(value: boolean): void {
  active = value;
}

/**
 * Background model discovery (REFACTOR_PLAN.md PR 3b commit 7). Separate
 * from the status-check semaphore above: Copilot/Codex's
 * discovery calls are just as expensive as their status checks, and a
 * regular (non-managed) provider's discovery has no status-check cycle to
 * piggyback on at all, so it needs its own bound.
 */
const discoverySemaphore = createSemaphore(DISCOVERY_CONCURRENCY);
/** Guards against the same provider being discovered twice concurrently --
 * e.g. a managed provider settling to "ready" right as the hourly sweep is
 * already checking it. */
const discoveryInFlight = new Set<string>();
// A saved managed catalog may have come from an older runtime or discovery
// path. Refresh it once per app session after sign-in, even within the 24h TTL.
const managedCatalogsRefreshedThisSession = new Set<string>();
const managedCatalogGeneration = new Map<string, number>();

export function invalidateManagedCatalog(id: string): void {
  managedCatalogsRefreshedThisSession.delete(id);
  managedCatalogGeneration.set(id, (managedCatalogGeneration.get(id) ?? 0) + 1);
}

function isDueForDiscovery(provider: CustomProvider, nowMs: number): boolean {
  const status = providerStatusOrUnknown(useWorkspaceStore.getState().providerStatus, provider.id);
  const isManaged = (MANAGED_PROVIDER_IDS as readonly string[]).includes(provider.id);
  const eligible = isEligibleForDiscovery({
    isManaged,
    statusKind: status.kind,
    authType: provider.authType,
    hasApiKey: Boolean(provider.apiKey?.trim()),
  });
  return eligible && (
    (isManaged && !managedCatalogsRefreshedThisSession.has(provider.id))
    || isCatalogStale({ modelsFetchedAt: provider.modelsFetchedAt }, nowMs)
  );
}

/**
 * Only ever called with the CURRENT saved provider object (never a form
 * draft) -- unlike LlmSetupTab's user-initiated Fetch/Test, which must
 * operate on unsaved edits (providerWithDraftSettings, LlmSetupTab.tsx),
 * background discovery has no draft to merge: it runs against whatever is
 * already persisted. Writes only `models`/`modelsFetchedAt` -- deliberately
 * never touches activeModel, unlike LlmSetupTab's own success handler,
 * since a background refresh silently changing what the user has selected
 * would be a surprise no user asked for.
 */
async function discoverModelsForProvider(provider: CustomProvider): Promise<void> {
  if (discoveryInFlight.has(provider.id)) return;
  discoveryInFlight.add(provider.id);
  const isManaged = isManagedProviderId(provider.id);
  const generation = managedCatalogGeneration.get(provider.id) ?? 0;
  const isCurrent = () => !isManaged || (
    active && generation === (managedCatalogGeneration.get(provider.id) ?? 0)
    && useWorkspaceStore.getState().providerStatus[provider.id]?.kind === "ready"
  );
  try {
    await discoverySemaphore.run(async () => {
      if (!isCurrent()) return;
      const models = await controlPlane.discoverModels(provider);
      // Login may have changed while this request was queued or in flight.
      if (!isCurrent()) return;
      useWorkspaceStore.getState().updateProviderSettings(provider.id, {
        models,
        modelsFetchedAt: new Date().toISOString(),
      });
      if (isManaged) {
        managedCatalogsRefreshedThisSession.add(provider.id);
      }
    });
  } catch (error) {
    console.error(`Background model discovery failed for "${provider.id}":`, error);
  } finally {
    discoveryInFlight.delete(provider.id);
    if (isManaged && generation !== (managedCatalogGeneration.get(provider.id) ?? 0)) {
      maybeDiscoverForProvider(provider.id);
    }
  }
}

export function maybeDiscoverForProvider(providerId: string): void {
  if (!active) return;
  const provider = useWorkspaceStore.getState().customProviders.find((candidate) => candidate.id === providerId);
  if (!provider || !isDueForDiscovery(provider, Date.now())) return;
  void discoverModelsForProvider(provider);
}

/**
 * Covers regular (non-managed) providers, which have no status-check cycle
 * to trigger discovery from, and re-checks managed providers too in case
 * one came due for a refresh between poll-driven checks. An hour between
 * sweeps against a 24h TTL is deliberately coarse -- discovery isn't
 * urgent, and every sweep tick costs at most DISCOVERY_CONCURRENCY
 * simultaneous sidecar calls.
 */
const DISCOVERY_SWEEP_INTERVAL_MS = 60 * 60 * 1_000;
let discoverySweepTimer: ReturnType<typeof setTimeout> | undefined;

export function scheduleDiscoverySweep(): void {
  if (!active) return;
  discoverySweepTimer = setTimeout(() => {
    void runDiscoverySweep().finally(scheduleDiscoverySweep);
  }, DISCOVERY_SWEEP_INTERVAL_MS);
}

export async function runDiscoverySweep(): Promise<void> {
  // The backend checks LiteLLM at most once a day; until then this reads its copy.
  void refreshModelLimits();
  const now = Date.now();
  const due = useWorkspaceStore.getState().customProviders.filter((provider) => isDueForDiscovery(provider, now));
  await Promise.all(due.map((provider) => discoverModelsForProvider(provider)));
}

/** Cancels the sweep timer and forgets in-flight and per-session bookkeeping. */
export function resetDiscovery(): void {
  if (discoverySweepTimer !== undefined) clearTimeout(discoverySweepTimer);
  discoverySweepTimer = undefined;
  discoveryInFlight.clear();
  managedCatalogsRefreshedThisSession.clear();
  managedCatalogGeneration.clear();
}
