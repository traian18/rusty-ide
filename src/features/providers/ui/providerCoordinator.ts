import { useWorkspaceStore } from "../../../store";
import { hybridControlPlane as controlPlane } from "../../../harness/HybridControlPlane";
import { createSemaphore } from "../integrations/concurrency";
import { isFastPollExpired, nextPollDelayMs, STALLED_LOGIN_MESSAGE } from "../integrations/schedule";
import type { CustomProvider } from "../../../store/types";
import {
  managedAuthCancelLogin,
  managedAuthSubmitCode,
  type ManagedAuthProvider,
} from "../../../harness/managedAuthClient";
import { notify } from "../../notifications";

import { MANAGED_PROVIDER_IDS, isManagedProviderId, mapManagedStatus, type ManagedProviderId, type ManagedStatus } from "./managedStatus";
import { invalidateManagedCatalog, maybeDiscoverForProvider, resetDiscovery, runDiscoverySweep, scheduleDiscoverySweep, setDiscoveryActive } from "./providerDiscovery";
import { resetQuotaWatch } from "./providerQuota";

export { mapManagedStatus } from "./managedStatus";
export { refreshProviderQuota, setQuotaWatch } from "./providerQuota";

/**
 * Owns the out-of-React polling that populates the integration registry
 * (REFACTOR_PLAN.md PR 3b) -- deliberately NOT under src/integrations/,
 * the same reason startupSteps.ts sits next to AppBootstrapBoundary.tsx
 * instead of under src/startup/: this module needs the real store and the
 * real hybridControlPlane, and src/integrations/layering.test.ts forbids
 * exactly those imports for the generic, pure-testable pieces
 * (registryTypes.ts, schedule.ts, concurrency.ts).
 *
 * Replaces today's three useManagedProviderStatus hooks, each mounted only
 * while LlmSetupTab is (its `keepAlive: "active-only"` policy unmounts and
 * destroys all three on tab switch) -- this runs for the life of the
 * session regardless of what tab is open, which is the entire point.
 *
 * Not started from here: startProviderCoordinator() is called once
 * AppBootstrapBoundary's startup run settles (a later commit), never at
 * this module's own import time -- providers don't exist meaningfully in
 * the store until the secure-config step completes.
 */

const STATUS_LOADERS: Record<ManagedProviderId, () => Promise<ManagedStatus>> = {
  "github-copilot": () => controlPlane.getCopilotStatus(),
  "openai-codex": () => controlPlane.getCodexStatus(),
};

/**
 * Bounds how many of the managed-provider status checks run at once.
 * Each one can be expensive on the sidecar side (Copilot: a full SDK client
 * cold start with no server-side timeout of its own; Codex: a child-process
 * spawn plus a 20s initialize) -- unbounded concurrency at every launch
 * would mean all of them paying their worst case simultaneously.
 */
const STATUS_CHECK_CONCURRENCY = 2;
const statusCheckSemaphore = createSemaphore(STATUS_CHECK_CONCURRENCY);

interface ManagedProviderRuntime {
  timer?: ReturnType<typeof setTimeout>;
  /** When the current unbroken "connecting" streak began. Lives here,
      not in the store: it's scheduler bookkeeping schedule.ts's fast-poll
      cap needs a wall-clock anchor for, not application state any
      surface should read. */
  connectingSinceMs?: number;
}

const runtime = new Map<ManagedProviderId, ManagedProviderRuntime>();

/**
 * Discards a response that arrives after a newer request for the same
 * provider has already been issued -- the case that matters is a slow poll
 * response landing after startManagedLogin (a later commit) or a manual
 * refresh has already superseded it. A monotonic sequence number rather
 * than comparing timestamps: no clock-resolution edge cases, and it works
 * identically for a request that fails, times out, or races a stop().
 */
let requestSeq = 0;
const latestRequestSeq = new Map<ManagedProviderId, number>();
const pendingLoginNotification = new Set<ManagedProviderId>();

let started = false;

function isSetupTabOpen(): boolean {
  return useWorkspaceStore.getState().tabs.some((tab) => tab.type === "llm-setup");
}

/**
 * Takes a signed-out provider's models out of the shared catalogue, and the
 * default model with them when it was one of those. Clearing
 * `modelsFetchedAt` too is what makes the next sign-in discover them again.
 */
function removeProviderModels(id: ManagedProviderId): void {
  const { activeModel, customProviders, setActiveModel, updateProviderSettings } = useWorkspaceStore.getState();
  const provider = customProviders.find((candidate) => candidate.id === id);
  if (provider && (provider.models.length > 0 || provider.modelsFetchedAt)) {
    updateProviderSettings(id, { models: [], modelsFetchedAt: undefined });
  }
  if (activeModel.startsWith(`${id}/`)) setActiveModel("");
}

function applySettled(id: ManagedProviderId, status: ManagedStatus, mySeq: number): void {
  if (latestRequestSeq.get(id) !== mySeq) return;
  const mapped = mapManagedStatus(status);
  const previous = useWorkspaceStore.getState().providerStatus[id];
  if (mapped.kind === "ready" && previous?.account !== mapped.account) {
    invalidateManagedCatalog(id);
  }
  // A session that ended outside the app: logged out in the CLI, or expired.
  if (mapped.kind === "unauthenticated" && previous?.kind === "ready") {
    invalidateManagedCatalog(id);
    removeProviderModels(id);
  }
  useWorkspaceStore.getState().patchProviderStatus(id, mapped);

  if (pendingLoginNotification.has(id)) {
    const isReadyForBrowserAuth =
      mapped.kind === "loading" &&
      Boolean(
        mapped.verificationUri ||
        mapped.userCode ||
        (id === "openai-codex" && !status.message?.includes("Downloading and installing"))
      );
    if (isReadyForBrowserAuth) {
      pendingLoginNotification.delete(id);
      const vendor = id === "openai-codex" ? "OpenAI" : "GitHub";
      const product = id === "openai-codex" ? "Codex" : "Copilot";
      notify(
        `${vendor} authorization`,
        `Complete the ${product} sign-in flow in your browser.`,
        "info",
      );
    } else if (mapped.kind !== "loading") {
      pendingLoginNotification.delete(id);
    }
  }

  // A managed provider's models can only ever be discovered once it's
  // actually signed in -- check right away rather than waiting for the
  // next hourly sweep, so a fresh sign-in doesn't sit with an empty
  // catalog for up to an hour.
  maybeDiscoverForProvider(id);
}

function applyError(id: ManagedProviderId, error: unknown, mySeq: number): void {
  if (latestRequestSeq.get(id) !== mySeq) return;
  useWorkspaceStore.getState().patchProviderStatus(id, {
    kind: "error",
    checkedAt: new Date().toISOString(),
    message: error instanceof Error ? error.message : "Status check failed.",
  });
}

async function checkProviderStatus(id: ManagedProviderId): Promise<void> {
  const mySeq = ++requestSeq;
  latestRequestSeq.set(id, mySeq);
  try {
    const status = await statusCheckSemaphore.run(() => STATUS_LOADERS[id]());
    applySettled(id, status, mySeq);
  } catch (error) {
    applyError(id, error, mySeq);
  }
  scheduleNextPoll(id);
}

function scheduleNextPoll(id: ManagedProviderId): void {
  if (!started) return;
  const rt = runtime.get(id) ?? {};
  runtime.set(id, rt);

  const entry = useWorkspaceStore.getState().providerStatus[id];
  const isConnecting = entry?.kind === "loading";
  if (isConnecting) {
    if (rt.connectingSinceMs === undefined) rt.connectingSinceMs = Date.now();
  } else {
    rt.connectingSinceMs = undefined;
  }

  const now = Date.now();
  if (isConnecting && rt.connectingSinceMs !== undefined && isFastPollExpired(rt.connectingSinceMs, now)) {
    useWorkspaceStore.getState().patchProviderStatus(id, { message: STALLED_LOGIN_MESSAGE });
  }

  const delay = nextPollDelayMs(
    { isConnecting, connectingSinceMs: rt.connectingSinceMs, isSetupTabOpen: isSetupTabOpen() },
    now,
  );
  rt.timer = setTimeout(() => void checkProviderStatus(id), delay);
}

/** Cancels a provider's pending poll timer (if any) and re-checks it right
 * away -- used after login/logout so the fresh result is visible
 * immediately, rather than waiting for whatever poll was already
 * scheduled (which could be minutes away at the background cadence). */
function forcePollNow(id: ManagedProviderId): void {
  const rt = runtime.get(id);
  if (rt?.timer !== undefined) clearTimeout(rt.timer);
  void checkProviderStatus(id);
}

const LOGIN_LOADERS: Record<ManagedProviderId, () => Promise<ManagedStatus>> = {
  "github-copilot": () => controlPlane.startCopilotLogin(),
  "openai-codex": () => controlPlane.startCodexLogin(),
};
const LOGOUT_LOADERS: Record<ManagedProviderId, () => Promise<ManagedStatus>> = {
  "github-copilot": () => controlPlane.logoutCopilot(),
  "openai-codex": () => controlPlane.logoutCodex(),
};

/**
 * Starts a managed-auth device-code login (REFACTOR_PLAN.md PR 3b commit
 * 9), replacing LlmSetupTab's own direct llmIntegrationService calls +
 * per-hook setStatus. Writes the registry through the same path a poll
 * would (forcePollNow -> checkProviderStatus -> applySettled), so the
 * fast-poll cadence and the sequence-number stale-response guard both
 * apply uniformly -- login is just another reason a status can change,
 * not a separate write path. Rethrows so the component can still show its
 * own error toast, matching today's UX.
 */
export async function startManagedLogin(provider: CustomProvider): Promise<void> {
  const id = provider.id;
  // Throws rather than returning silently: LlmSetupTab renders its sign-in
  // button from the transport-OR-id predicates (providerHelpers.ts's
  // isCodexProvider etc.), while this dispatch is keyed on the id
  // alone -- so a provider matched only by transport used to get a button
  // whose click did nothing at all: no browser, no error, no status
  // change. A visible error beats a dead button.
  if (!isManagedProviderId(id)) {
    throw new Error(`'${provider.id}' is not one of the managed-auth providers (${MANAGED_PROVIDER_IDS.join(", ")}), so it has no sign-in flow.`);
  }
  pendingLoginNotification.add(id);
  invalidateManagedCatalog(id);
  useWorkspaceStore.getState().patchProviderStatus(id, {
    kind: "loading",
    verificationUri: undefined,
    userCode: undefined,
  });
  try {
    await LOGIN_LOADERS[id]();
  } catch (error) {
    pendingLoginNotification.delete(id);
    useWorkspaceStore.getState().patchProviderStatus(id, {
      kind: "error",
      checkedAt: new Date().toISOString(),
      message: error instanceof Error ? error.message : `Could not start ${id} authorization.`,
    });
    throw error;
  }
  forcePollNow(id);
}

/** Mirrors startManagedLogin's shape. Leaves status untouched on failure,
 * matching today's handleManagedLogout (which only ever updates status on
 * success). */
export async function logoutManaged(provider: CustomProvider): Promise<void> {
  const id = provider.id;
  if (!isManagedProviderId(id)) {
    throw new Error(`'${provider.id}' is not one of the managed-auth providers (${MANAGED_PROVIDER_IDS.join(", ")}), so it has no sign-out flow.`);
  }
  pendingLoginNotification.delete(id);
  await LOGOUT_LOADERS[id]();
  invalidateManagedCatalog(id);
  removeProviderModels(id);
  forcePollNow(id);
}

function managedIntegrationForProviderId(id: ManagedProviderId): ManagedAuthProvider {
  switch (id) {
    case "openai-codex":
      return "codex";
    case "github-copilot":
      return "github-copilot";
  }
}

/**
 * Submits an authentication code
 * into the in-flight login process's stdin.
 */
export async function submitManagedAuthCode(provider: CustomProvider, rawCode: string): Promise<void> {
  const id = provider.id;
  if (!isManagedProviderId(id)) {
    throw new Error(`'${provider.id}' is not one of the managed-auth providers (${MANAGED_PROVIDER_IDS.join(", ")}).`);
  }
  const code = rawCode.trim();
  const integration = managedIntegrationForProviderId(id);
  await managedAuthSubmitCode(integration, code);
  forcePollNow(id);
}

/**
 * Cancels an in-flight managed login attempt, aborting the child process.
 */
export async function cancelManagedLogin(provider: CustomProvider): Promise<void> {
  const id = provider.id;
  if (!isManagedProviderId(id)) {
    throw new Error(`'${provider.id}' is not one of the managed-auth providers (${MANAGED_PROVIDER_IDS.join(", ")}).`);
  }
  pendingLoginNotification.delete(id);
  const integration = managedIntegrationForProviderId(id);
  await managedAuthCancelLogin(integration);
  forcePollNow(id);
}

/**
 * Idempotent -- a second call while already started is a no-op, the same
 * shape as beginRun()'s own activeRun guard in AppBootstrapBoundary.tsx.
 */
export function startProviderCoordinator(): void {
  if (started) return;
  started = true;
  setDiscoveryActive(true);
  for (const id of MANAGED_PROVIDER_IDS) {
    void checkProviderStatus(id);
  }
  void runDiscoverySweep().finally(scheduleDiscoverySweep);
}

/** Cancels every pending timer and resets all bookkeeping. Exported for
 * tests, which need isolation between cases against this module's
 * otherwise-persistent state -- there is no product-code caller of this
 * today; the coordinator runs for the life of the session once started. */
export function stopProviderCoordinator(): void {
  started = false;
  pendingLoginNotification.clear();
  for (const rt of runtime.values()) {
    if (rt.timer !== undefined) clearTimeout(rt.timer);
  }
  runtime.clear();
  latestRequestSeq.clear();
  resetDiscovery();
  resetQuotaWatch();
  setDiscoveryActive(false);
}
