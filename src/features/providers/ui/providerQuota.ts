import { useWorkspaceStore } from "../../../store";
import { hybridControlPlane as controlPlane } from "../../../harness/HybridControlPlane";
import type { CustomProvider } from "../../../store/types";

/**
 * Quota (REFACTOR_PLAN.md PR 3b commit 8). Deliberately scoped to ONE
 * watched provider at a time, matching ProviderQuotaControl's existing
 * behavior exactly (it only ever shows the single provider selected in its
 * dropdown) -- proactively fetching quota for every eligible provider on a
 * timer would be a real, avoidable new cost: every managed provider's
 * quota path spawns its vendored CLI afresh on each call (src-tauri/src/
 * harness/managed_quota.rs -- a one-shot JSON-RPC session for Copilot/
 * Codex), so there is no
 * warm-state amortization to rely on.
 */
const QUOTA_REFRESH_INTERVAL_MS = 5 * 60 * 1_000;
let quotaWatchProviderId: string | null = null;
let quotaWatchTimer: ReturnType<typeof setTimeout> | undefined;
let quotaRequestSeq = 0;
const latestQuotaRequestSeq = new Map<string, number>();

async function refreshQuotaNow(provider: CustomProvider): Promise<void> {
  const mySeq = ++quotaRequestSeq;
  latestQuotaRequestSeq.set(provider.id, mySeq);
  useWorkspaceStore.getState().patchProviderStatus(provider.id, { quotaLoading: true, quotaError: undefined });
  try {
    const quota = await controlPlane.getQuota(provider);
    if (latestQuotaRequestSeq.get(provider.id) !== mySeq) return;
    useWorkspaceStore.getState().patchProviderStatus(provider.id, { quota, quotaLoading: false, quotaError: undefined });
  } catch (error) {
    if (latestQuotaRequestSeq.get(provider.id) !== mySeq) return;
    useWorkspaceStore.getState().patchProviderStatus(provider.id, {
      quotaLoading: false,
      quotaError: error instanceof Error ? error.message : "Quota request failed.",
    });
  }
}

/**
 * Sets which single provider's quota is being actively watched -- called
 * by ProviderQuotaControl on mount and whenever its selection changes.
 * Fetches immediately, then re-fetches (re-reading the provider fresh from
 * the store each time, in case its authType/apiKey changed) every
 * QUOTA_REFRESH_INTERVAL_MS. Pass null to stop watching entirely.
 */
export function setQuotaWatch(provider: CustomProvider | null): void {
  if (quotaWatchTimer !== undefined) clearTimeout(quotaWatchTimer);
  quotaWatchTimer = undefined;
  quotaWatchProviderId = provider?.id ?? null;
  if (!provider) return;

  void refreshQuotaNow(provider);
  quotaWatchTimer = setTimeout(() => {
    const current = useWorkspaceStore.getState().customProviders.find((p) => p.id === quotaWatchProviderId);
    if (current) setQuotaWatch(current);
  }, QUOTA_REFRESH_INTERVAL_MS);
}

/** The dropdown's manual "Refresh" button -- independent of the watch
 * timer's own cadence, matching today's handleRefresh (which never reset
 * the underlying setInterval either). */
export function refreshProviderQuota(provider: CustomProvider): void {
  void refreshQuotaNow(provider);
}

/** Stops the watch and forgets in-flight requests. */
export function resetQuotaWatch(): void {
  if (quotaWatchTimer !== undefined) clearTimeout(quotaWatchTimer);
  quotaWatchTimer = undefined;
  quotaWatchProviderId = null;
  latestQuotaRequestSeq.clear();
}
