import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useWorkspaceStore } from "../../store";
import { useNotificationStore } from "../../notificationStore";
import {
  cancelManagedLogin,
  logoutManaged,
  mapManagedStatus,
  normalizeClaudeAuthCode,
  refreshProviderQuota,
  setQuotaWatch,
  startManagedLogin,
  startProviderCoordinator,
  stopProviderCoordinator,
  submitManagedAuthCode,
} from "./providerCoordinator";
import {
  BACKGROUND_POLL_INTERVAL_MS,
  FAST_POLL_INTERVAL_MS,
  FAST_POLL_MAX_DURATION_MS,
  STALLED_LOGIN_MESSAGE,
  TAB_OPEN_POLL_INTERVAL_MS,
} from "../../integrations/schedule";

// Mocks providerCoordinator.ts's own direct dependency (hybridControlPlane),
// not something two layers further down -- sidecar-removal Phase 8c: there
// is no more sidecar/llmIntegrationService to reach into, and mocking the
// real boundary this file actually calls is more correct regardless (real
// HTTP-fetch/model-transformation behavior is providerCatalog.test.ts's own
// job, real Rust-command behavior is HybridControlPlane.test.ts's own job --
// this file is only about the coordinator's scheduling/dedup/concurrency
// logic).
vi.mock("../../harness/HybridControlPlane", () => ({
  hybridControlPlane: {
    discoverModels: vi.fn(),
    testConnection: vi.fn(),
    getQuota: vi.fn(),
    getCopilotStatus: vi.fn(),
    startCopilotLogin: vi.fn(),
    logoutCopilot: vi.fn(),
    getCodexStatus: vi.fn(),
    startCodexLogin: vi.fn(),
    logoutCodex: vi.fn(),
    getClaudeCodeStatus: vi.fn(),
    startClaudeCodeLogin: vi.fn(),
    logoutClaudeCode: vi.fn(),
    recordUsage: vi.fn(),
  },
}));

vi.mock("../../harness/managedAuthClient", () => ({
  managedAuthSubmitCode: vi.fn(),
  managedAuthCancelLogin: vi.fn(),
}));

import { hybridControlPlane } from "../../harness/HybridControlPlane";
import { managedAuthCancelLogin, managedAuthSubmitCode } from "../../harness/managedAuthClient";

const STATUS_LOADERS = {
  "github-copilot": hybridControlPlane.getCopilotStatus,
  "openai-codex": hybridControlPlane.getCodexStatus,
  "anthropic-claude-code": hybridControlPlane.getClaudeCodeStatus,
} as const;

function connectionStatus(overrides: Partial<{ state: "disconnected" | "connecting" | "connected" | "failed"; authenticated: boolean; message: string }> = {}) {
  return { state: "disconnected" as const, authenticated: false, ...overrides };
}

/** A minimal, deterministic provider fixture -- NOT the real defaultProviders
 * (createIntegrationSlice.ts), since this test file runs against the real,
 * singleton useWorkspaceStore and must not depend on incidental fields
 * (apiKey/authType) of the app's actual default catalog. */
const REGULAR_PROVIDER_WITH_KEY = {
  id: "regular-with-key",
  name: "Regular (API key)",
  baseUrl: "https://example.test/v1",
  apiKey: "sk-test",
  apiType: "openai-completions",
  authType: "bearer" as const,
  models: [],
};
const REGULAR_PROVIDER_NO_KEY = {
  id: "regular-no-key",
  name: "Regular (no key)",
  baseUrl: "https://example.test/v1",
  apiKey: "",
  apiType: "openai-completions",
  authType: "bearer" as const,
  models: [],
};
const MANAGED_PROVIDER_FIXTURE = {
  id: "github-copilot",
  name: "GitHub Copilot",
  baseUrl: "",
  apiKey: "",
  apiType: "copilot-sdk",
  authType: "environment" as const,
  models: [],
};
/** A second managed provider -- only needed by the "quota watch" tests
 * below, which must watch *two different* providers to exercise
 * switch/cancel behavior. */
const MANAGED_PROVIDER_FIXTURE_2 = {
  id: "openai-codex",
  name: "OpenAI Codex",
  baseUrl: "",
  apiKey: "",
  apiType: "codex-app-server",
  authType: "environment" as const,
  transport: "openai-codex-app-server" as const,
  models: [],
};

function resetManagedProviderStatus() {
  useWorkspaceStore.setState({
    providerStatus: {},
    tabs: [],
    customProviders: [REGULAR_PROVIDER_WITH_KEY, REGULAR_PROVIDER_NO_KEY, MANAGED_PROVIDER_FIXTURE, MANAGED_PROVIDER_FIXTURE_2],
  } as any);
}

describe("mapManagedStatus", () => {
  it("maps 'connected' to 'ready', carrying the account label through", () => {
    expect(
      mapManagedStatus({ state: "connected", authenticated: true, login: "octocat" } as any),
    ).toEqual({
      kind: "ready",
      checkedAt: expect.any(String),
      message: undefined,
      diagnostics: undefined,
      account: "octocat",
    });
  });

  it("prefers `login` over `email` when both happen to be present", () => {
    expect(
      mapManagedStatus({ state: "connected", authenticated: true, login: "octocat", email: "x@example.com" } as any)
        .account,
    ).toBe("octocat");
  });

  it("falls back to `email` for Codex/Claude Code", () => {
    expect(
      mapManagedStatus({ state: "connected", authenticated: true, email: "dev@example.com" } as any).account,
    ).toBe("dev@example.com");
  });

  it("maps 'connecting' to 'loading', carrying the device code through", () => {
    expect(
      mapManagedStatus({
        state: "connecting",
        authenticated: false,
        verificationUri: "https://github.com/login/device",
        userCode: "ABCD-1234",
      } as any),
    ).toEqual({
      kind: "loading",
      checkedAt: expect.any(String),
      message: undefined,
      diagnostics: undefined,
      verificationUri: "https://github.com/login/device",
      userCode: "ABCD-1234",
    });
  });

  it("maps 'disconnected' to 'unauthenticated' -- distinct from 'error'", () => {
    expect(mapManagedStatus({ state: "disconnected", authenticated: false } as any).kind).toBe(
      "unauthenticated",
    );
  });

  it("maps 'failed' to 'error', carrying the message and diagnostics through", () => {
    expect(
      mapManagedStatus({
        state: "failed",
        authenticated: false,
        message: "Sign-in expired.",
        diagnostics: ["exit code 1"],
      } as any),
    ).toEqual({
      kind: "error",
      checkedAt: expect.any(String),
      message: "Sign-in expired.",
      diagnostics: ["exit code 1"],
      account: undefined,
    });
  });
});

describe("providerCoordinator", () => {
  beforeEach(() => {
    resetManagedProviderStatus();
    for (const loader of Object.values(STATUS_LOADERS)) vi.mocked(loader).mockReset();
    vi.mocked(hybridControlPlane.discoverModels).mockReset().mockResolvedValue([]);
    vi.mocked(hybridControlPlane.getQuota).mockReset();
    vi.mocked(hybridControlPlane.startCopilotLogin).mockReset();
    vi.mocked(hybridControlPlane.startCodexLogin).mockReset();
    vi.mocked(hybridControlPlane.startClaudeCodeLogin).mockReset();
    vi.mocked(hybridControlPlane.logoutCopilot).mockReset();
    vi.mocked(hybridControlPlane.logoutCodex).mockReset();
    vi.mocked(hybridControlPlane.logoutClaudeCode).mockReset();
    vi.useFakeTimers();
  });

  afterEach(() => {
    stopProviderCoordinator();
    setQuotaWatch(null);
    vi.useRealTimers();
  });

  it("checks all three managed providers immediately on start", async () => {
    for (const loader of Object.values(STATUS_LOADERS)) vi.mocked(loader).mockResolvedValue(connectionStatus());

    startProviderCoordinator();
    await vi.advanceTimersByTimeAsync(0);

    expect(hybridControlPlane.getCopilotStatus).toHaveBeenCalledTimes(1);
    expect(hybridControlPlane.getCodexStatus).toHaveBeenCalledTimes(1);
    expect(hybridControlPlane.getClaudeCodeStatus).toHaveBeenCalledTimes(1);
  });

  it("starting twice is a no-op -- does not double the in-flight checks", async () => {
    for (const loader of Object.values(STATUS_LOADERS)) vi.mocked(loader).mockResolvedValue(connectionStatus());

    startProviderCoordinator();
    startProviderCoordinator();
    await vi.advanceTimersByTimeAsync(0);

    expect(hybridControlPlane.getCopilotStatus).toHaveBeenCalledTimes(1);
  });

  it("writes the mapped status into the registry once a check settles", async () => {
    vi.mocked(hybridControlPlane.getCopilotStatus).mockResolvedValue(connectionStatus({ state: "connected", authenticated: true }) as any);
    vi.mocked(hybridControlPlane.getCodexStatus).mockResolvedValue(connectionStatus());
    vi.mocked(hybridControlPlane.getClaudeCodeStatus).mockResolvedValue(connectionStatus());

    startProviderCoordinator();
    await vi.advanceTimersByTimeAsync(0);

    expect(useWorkspaceStore.getState().providerStatus["github-copilot"]).toMatchObject({ kind: "ready" });
  });

  it("bounds concurrency -- the third status check does not start until one of the first two finishes", async () => {
    let copilotResolve!: (value: any) => void;
    const copilotPending = new Promise((resolve) => (copilotResolve = resolve));
    vi.mocked(hybridControlPlane.getCopilotStatus).mockReturnValue(copilotPending as any);
    let codexResolve!: (value: any) => void;
    const codexPending = new Promise((resolve) => (codexResolve = resolve));
    vi.mocked(hybridControlPlane.getCodexStatus).mockReturnValue(codexPending as any);
    vi.mocked(hybridControlPlane.getClaudeCodeStatus).mockResolvedValue(connectionStatus());

    startProviderCoordinator();
    await vi.advanceTimersByTimeAsync(0);

    // Two of the three loaders were invoked; the third's underlying call
    // must not have started yet, since the semaphore (concurrency 2) is
    // holding both slots on the first two.
    expect(hybridControlPlane.getClaudeCodeStatus).not.toHaveBeenCalled();

    copilotResolve(connectionStatus({ state: "connected", authenticated: true }));
    await vi.advanceTimersByTimeAsync(0);
    expect(hybridControlPlane.getClaudeCodeStatus).toHaveBeenCalledTimes(1);

    codexResolve(connectionStatus());
    await vi.advanceTimersByTimeAsync(0);
  });

  it("polls again at the fast (1s) interval while a provider reports 'connecting'", async () => {
    vi.mocked(hybridControlPlane.getCopilotStatus).mockResolvedValue(connectionStatus({ state: "connecting" }) as any);
    vi.mocked(hybridControlPlane.getCodexStatus).mockResolvedValue(connectionStatus());
    vi.mocked(hybridControlPlane.getClaudeCodeStatus).mockResolvedValue(connectionStatus());

    startProviderCoordinator();
    await vi.advanceTimersByTimeAsync(0);
    expect(hybridControlPlane.getCopilotStatus).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(FAST_POLL_INTERVAL_MS - 1);
    expect(hybridControlPlane.getCopilotStatus).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1);
    expect(hybridControlPlane.getCopilotStatus).toHaveBeenCalledTimes(2);
  });

  it("polls at the background (5 min) interval once settled and the setup tab is closed", async () => {
    vi.mocked(hybridControlPlane.getCopilotStatus).mockResolvedValue(connectionStatus({ state: "connected", authenticated: true }) as any);
    vi.mocked(hybridControlPlane.getCodexStatus).mockResolvedValue(connectionStatus());
    vi.mocked(hybridControlPlane.getClaudeCodeStatus).mockResolvedValue(connectionStatus());

    startProviderCoordinator();
    await vi.advanceTimersByTimeAsync(0);
    expect(hybridControlPlane.getCopilotStatus).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(BACKGROUND_POLL_INTERVAL_MS - 1);
    expect(hybridControlPlane.getCopilotStatus).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1);
    expect(hybridControlPlane.getCopilotStatus).toHaveBeenCalledTimes(2);
  });

  it("polls at the tab-open (10s) interval once settled while the LLM Setup tab is mounted", async () => {
    useWorkspaceStore.setState({
      tabs: [{ id: "llm-setup", type: "llm-setup", title: "LLM Integrations", status: "idle", dirty: false }],
    } as any);
    vi.mocked(hybridControlPlane.getCopilotStatus).mockResolvedValue(connectionStatus({ state: "connected", authenticated: true }) as any);
    vi.mocked(hybridControlPlane.getCodexStatus).mockResolvedValue(connectionStatus());
    vi.mocked(hybridControlPlane.getClaudeCodeStatus).mockResolvedValue(connectionStatus());

    startProviderCoordinator();
    await vi.advanceTimersByTimeAsync(0);
    expect(hybridControlPlane.getCopilotStatus).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(TAB_OPEN_POLL_INTERVAL_MS - 1);
    expect(hybridControlPlane.getCopilotStatus).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1);
    expect(hybridControlPlane.getCopilotStatus).toHaveBeenCalledTimes(2);
  });

  it("drops out of the fast tier and records a stalled-login message once a connecting streak outlives the cap", async () => {
    vi.mocked(hybridControlPlane.getCopilotStatus).mockResolvedValue(connectionStatus({ state: "connecting" }) as any);
    vi.mocked(hybridControlPlane.getCodexStatus).mockResolvedValue(connectionStatus());
    vi.mocked(hybridControlPlane.getClaudeCodeStatus).mockResolvedValue(connectionStatus());

    startProviderCoordinator();
    await vi.advanceTimersByTimeAsync(FAST_POLL_MAX_DURATION_MS);

    expect(useWorkspaceStore.getState().providerStatus["github-copilot"].message).toBe(STALLED_LOGIN_MESSAGE);
    // Sanity: the fast tier really was in effect for most of that stretch,
    // not something else entirely -- roughly one call per second.
    expect(vi.mocked(hybridControlPlane.getCopilotStatus).mock.calls.length).toBeGreaterThan(
      FAST_POLL_MAX_DURATION_MS / FAST_POLL_INTERVAL_MS - 5,
    );
  }, 20_000);

  it("stopProviderCoordinator cancels pending timers so no further checks fire", async () => {
    vi.mocked(hybridControlPlane.getCopilotStatus).mockResolvedValue(connectionStatus({ state: "connecting" }) as any);
    vi.mocked(hybridControlPlane.getCodexStatus).mockResolvedValue(connectionStatus());
    vi.mocked(hybridControlPlane.getClaudeCodeStatus).mockResolvedValue(connectionStatus());

    startProviderCoordinator();
    await vi.advanceTimersByTimeAsync(0);
    const callsBeforeStop = vi.mocked(hybridControlPlane.getCopilotStatus).mock.calls.length;

    stopProviderCoordinator();
    await vi.advanceTimersByTimeAsync(FAST_POLL_INTERVAL_MS * 5);

    expect(vi.mocked(hybridControlPlane.getCopilotStatus).mock.calls.length).toBe(callsBeforeStop);
  });

  // The requestSeq/latestRequestSeq guard (see this module's own comment
  // above applySettled/applyError) exists to protect against a manual
  // refresh -- or any other future second trigger for the same provider --
  // superseding an older, still-in-flight check. The coordinator's own
  // poll loop can never produce that race by itself (scheduleNextPoll only
  // runs after the previous check for that provider has already settled),
  // so there is nothing to exercise it against yet without leaking a
  // permanently-queued task into the shared concurrency semaphore. It gets
  // a real test once a manual-refresh entry point exists (a later commit).

  describe("background model discovery", () => {
    it("discovers models on start for a regular provider with an API key", async () => {
      vi.mocked(hybridControlPlane.discoverModels).mockImplementation(async (provider) =>
        provider.id === "regular-with-key" ? [{ id: "regular-with-key/some-model", remoteId: "some-model", name: "Some Model" } as any] : [],
      );
      for (const loader of Object.values(STATUS_LOADERS)) vi.mocked(loader).mockResolvedValue(connectionStatus());

      startProviderCoordinator();
      await vi.advanceTimersByTimeAsync(0);

      expect(hybridControlPlane.discoverModels).toHaveBeenCalledWith(expect.objectContaining({ id: "regular-with-key" }));

      const provider = useWorkspaceStore.getState().customProviders.find((p) => p.id === "regular-with-key");
      expect(provider?.models).toEqual([expect.objectContaining({ id: "regular-with-key/some-model", remoteId: "some-model" })]);
      expect(provider?.modelsFetchedAt).toEqual(expect.any(String));
    });

    it("never discovers a regular provider with no API key", async () => {
      for (const loader of Object.values(STATUS_LOADERS)) vi.mocked(loader).mockResolvedValue(connectionStatus());

      startProviderCoordinator();
      await vi.advanceTimersByTimeAsync(0);

      const calledIds = vi.mocked(hybridControlPlane.discoverModels).mock.calls.map((call) => call[0].id);
      expect(calledIds).not.toContain("regular-no-key");
    });

    it("does not discover a managed provider until its status is 'ready'", async () => {
      vi.mocked(hybridControlPlane.getCopilotStatus).mockResolvedValue(connectionStatus({ state: "connecting" }) as any);
      vi.mocked(hybridControlPlane.getCodexStatus).mockResolvedValue(connectionStatus());
      vi.mocked(hybridControlPlane.getClaudeCodeStatus).mockResolvedValue(connectionStatus());

      startProviderCoordinator();
      await vi.advanceTimersByTimeAsync(0);

      const calledIds = vi.mocked(hybridControlPlane.discoverModels).mock.calls.map((call) => call[0].id);
      expect(calledIds).not.toContain("github-copilot");
    });

    it("discovers a managed provider's models as soon as its status settles to 'ready'", async () => {
      vi.mocked(hybridControlPlane.getCopilotStatus).mockResolvedValue(connectionStatus({ state: "connected", authenticated: true }) as any);
      vi.mocked(hybridControlPlane.getCodexStatus).mockResolvedValue(connectionStatus());
      vi.mocked(hybridControlPlane.getClaudeCodeStatus).mockResolvedValue(connectionStatus());

      startProviderCoordinator();
      await vi.advanceTimersByTimeAsync(0);

      expect(hybridControlPlane.discoverModels).toHaveBeenCalledWith(
        expect.objectContaining({ id: "github-copilot" }),
      );
    });

    it("does not re-discover a catalog that was fetched within the TTL", async () => {
      useWorkspaceStore.setState((state) => ({
        customProviders: state.customProviders.map((p) =>
          p.id === "regular-with-key" ? { ...p, modelsFetchedAt: new Date().toISOString() } : p,
        ),
      }));
      for (const loader of Object.values(STATUS_LOADERS)) vi.mocked(loader).mockResolvedValue(connectionStatus());

      startProviderCoordinator();
      await vi.advanceTimersByTimeAsync(0);

      const calledIds = vi.mocked(hybridControlPlane.discoverModels).mock.calls.map((call) => call[0].id);
      expect(calledIds).not.toContain("regular-with-key");
    });

    it("bounds discovery concurrency across providers", async () => {
      vi.mocked(hybridControlPlane.getCopilotStatus).mockResolvedValue(connectionStatus({ state: "connected", authenticated: true }) as any);
      vi.mocked(hybridControlPlane.getCodexStatus).mockResolvedValue(connectionStatus());
      vi.mocked(hybridControlPlane.getClaudeCodeStatus).mockResolvedValue(connectionStatus());
      let activeDiscoveries = 0;
      let maxObserved = 0;
      vi.mocked(hybridControlPlane.discoverModels).mockImplementation(async () => {
        activeDiscoveries++;
        maxObserved = Math.max(maxObserved, activeDiscoveries);
        await Promise.resolve();
        activeDiscoveries--;
        return [];
      });

      startProviderCoordinator();
      await vi.advanceTimersByTimeAsync(0);

      // Three eligible providers by the time copilot settles to "ready"
      // (regular-with-key, and github-copilot once ready) -- concurrency
      // is bounded at DISCOVERY_CONCURRENCY (2).
      expect(maxObserved).toBeLessThanOrEqual(2);
    });
  });

  describe("quota watch", () => {
    // A regular provider's quota now answers directly and synchronously
    // (providerCatalog.ts's fetchProviderQuotaDirect via HybridControlPlane.ts
    // -- no network call at all), so these tests -- which are about the
    // *scheduling* mechanism (timers, switch/cancel, supersession), not
    // about any particular provider's quota shape -- use the two
    // managed-provider fixtures instead, whose quota goes through this
    // file's own mockable hybridControlPlane.getQuota.
    const quotaSnapshot = {
      providerId: "github-copilot",
      providerName: "GitHub Copilot",
      state: "available" as const,
      source: "test",
      fetchedAt: "2026-09-12T00:00:00.000Z",
      windows: [],
    };

    it("fetches quota immediately when a provider starts being watched", async () => {
      vi.mocked(hybridControlPlane.getQuota).mockResolvedValue(quotaSnapshot);

      setQuotaWatch(MANAGED_PROVIDER_FIXTURE as any);
      await vi.advanceTimersByTimeAsync(0);

      expect(hybridControlPlane.getQuota).toHaveBeenCalledTimes(1);
      expect(useWorkspaceStore.getState().providerStatus["github-copilot"]).toMatchObject({
        quota: quotaSnapshot,
        quotaLoading: false,
      });
    });

    it("re-fetches at the 5-minute interval while still watched", async () => {
      vi.mocked(hybridControlPlane.getQuota).mockResolvedValue(quotaSnapshot);

      setQuotaWatch(MANAGED_PROVIDER_FIXTURE as any);
      await vi.advanceTimersByTimeAsync(0);
      expect(hybridControlPlane.getQuota).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(5 * 60 * 1_000 - 1);
      expect(hybridControlPlane.getQuota).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(1);
      expect(hybridControlPlane.getQuota).toHaveBeenCalledTimes(2);
    });

    it("switching the watched provider cancels the previous one's timer", async () => {
      vi.mocked(hybridControlPlane.getQuota).mockResolvedValue(quotaSnapshot);

      setQuotaWatch(MANAGED_PROVIDER_FIXTURE as any);
      await vi.advanceTimersByTimeAsync(0);
      setQuotaWatch(MANAGED_PROVIDER_FIXTURE_2 as any);
      await vi.advanceTimersByTimeAsync(0);
      vi.mocked(hybridControlPlane.getQuota).mockClear();

      // If the first provider's timer were still alive, this would fire an
      // extra call for it.
      await vi.advanceTimersByTimeAsync(5 * 60 * 1_000);
      expect(hybridControlPlane.getQuota).toHaveBeenCalledTimes(1);
      expect(hybridControlPlane.getQuota).toHaveBeenCalledWith(
        expect.objectContaining({ id: "openai-codex" }),
      );
    });

    it("passing null stops watching entirely", async () => {
      vi.mocked(hybridControlPlane.getQuota).mockResolvedValue(quotaSnapshot);
      setQuotaWatch(MANAGED_PROVIDER_FIXTURE as any);
      await vi.advanceTimersByTimeAsync(0);

      setQuotaWatch(null);
      vi.mocked(hybridControlPlane.getQuota).mockClear();
      await vi.advanceTimersByTimeAsync(5 * 60 * 1_000);

      expect(hybridControlPlane.getQuota).not.toHaveBeenCalled();
    });

    it("records a quota error without clobbering existing status fields", async () => {
      useWorkspaceStore.getState().setProviderStatus("github-copilot", { kind: "unknown", account: "keep-me" });
      vi.mocked(hybridControlPlane.getQuota).mockRejectedValue(new Error("quota endpoint down"));

      setQuotaWatch(MANAGED_PROVIDER_FIXTURE as any);
      await vi.advanceTimersByTimeAsync(0);

      expect(useWorkspaceStore.getState().providerStatus["github-copilot"]).toMatchObject({
        account: "keep-me",
        quotaError: "quota endpoint down",
        quotaLoading: false,
      });
    });

    it("refreshProviderQuota fetches once without disturbing the watch timer's own cadence", async () => {
      vi.mocked(hybridControlPlane.getQuota).mockResolvedValue(quotaSnapshot);
      setQuotaWatch(MANAGED_PROVIDER_FIXTURE as any);
      await vi.advanceTimersByTimeAsync(0);
      vi.mocked(hybridControlPlane.getQuota).mockClear();

      refreshProviderQuota(MANAGED_PROVIDER_FIXTURE as any);
      await vi.advanceTimersByTimeAsync(0);
      expect(hybridControlPlane.getQuota).toHaveBeenCalledTimes(1);

      // The watch's own timer, started before the manual refresh, still
      // fires on its original schedule -- matching today's handleRefresh,
      // which never reset the underlying setInterval either.
      await vi.advanceTimersByTimeAsync(5 * 60 * 1_000);
      expect(hybridControlPlane.getQuota).toHaveBeenCalledTimes(2);
    });

    it("discards a quota response superseded by a newer request for the same provider", async () => {
      let firstResolve!: (value: any) => void;
      const firstPending = new Promise((resolve) => (firstResolve = resolve));
      vi.mocked(hybridControlPlane.getQuota)
        .mockReturnValueOnce(firstPending as any)
        .mockResolvedValueOnce({ ...quotaSnapshot, source: "second" });

      setQuotaWatch(MANAGED_PROVIDER_FIXTURE as any);
      await vi.advanceTimersByTimeAsync(0);
      refreshProviderQuota(MANAGED_PROVIDER_FIXTURE as any);
      await vi.advanceTimersByTimeAsync(0);

      firstResolve({ ...quotaSnapshot, source: "first-should-be-dropped" });
      await vi.advanceTimersByTimeAsync(0);

      expect(useWorkspaceStore.getState().providerStatus["github-copilot"]?.quota?.source).toBe("second");
    });
  });

  describe("startManagedLogin / logoutManaged", () => {
    it("starts a login and re-checks status immediately, surfacing the fresh result", async () => {
      vi.mocked(hybridControlPlane.startCopilotLogin).mockResolvedValue(connectionStatus({ state: "connecting" }) as any);
      vi.mocked(hybridControlPlane.getCopilotStatus).mockResolvedValue(
        connectionStatus({ state: "connecting" }) as any,
      );
      vi.mocked(hybridControlPlane.getCopilotStatus).mockResolvedValue({
        state: "connecting",
        authenticated: false,
        verificationUri: "https://github.com/login/device",
        userCode: "ABCD-1234",
      } as any);

      await startManagedLogin(MANAGED_PROVIDER_FIXTURE as any);
      await vi.advanceTimersByTimeAsync(0);

      expect(hybridControlPlane.startCopilotLogin).toHaveBeenCalledTimes(1);
      expect(hybridControlPlane.getCopilotStatus).toHaveBeenCalledTimes(1);
      expect(useWorkspaceStore.getState().providerStatus["github-copilot"]).toMatchObject({
        kind: "loading",
        userCode: "ABCD-1234",
      });
    });

    it("records an error status and rethrows when the login call itself fails", async () => {
      vi.mocked(hybridControlPlane.startCopilotLogin).mockRejectedValue(new Error("network down"));

      await expect(startManagedLogin(MANAGED_PROVIDER_FIXTURE as any)).rejects.toThrow("network down");

      expect(useWorkspaceStore.getState().providerStatus["github-copilot"]).toMatchObject({
        kind: "error",
        message: "network down",
      });
      // No status re-check on a failed login -- there's nothing fresh to
      // confirm.
      expect(hybridControlPlane.getCopilotStatus).not.toHaveBeenCalled();
    });

    it("rejects for a non-managed provider id rather than silently doing nothing", async () => {
      // A silent return here is what made LlmSetupTab's sign-in button
      // look dead for a provider matched only by transport: no browser, no
      // error, no status change.
      await expect(startManagedLogin(REGULAR_PROVIDER_WITH_KEY as any)).rejects.toThrow(/no sign-in flow/);
      expect(hybridControlPlane.startCopilotLogin).not.toHaveBeenCalled();
      expect(hybridControlPlane.startCodexLogin).not.toHaveBeenCalled();
    });

    it("rejects a sign-out for a non-managed provider id too", async () => {
      await expect(logoutManaged(REGULAR_PROVIDER_WITH_KEY as any)).rejects.toThrow(/no sign-out flow/);
      expect(hybridControlPlane.logoutCopilot).not.toHaveBeenCalled();
    });

    it("logs out and re-checks status immediately", async () => {
      vi.mocked(hybridControlPlane.logoutCopilot).mockResolvedValue(connectionStatus() as any);
      vi.mocked(hybridControlPlane.getCopilotStatus).mockResolvedValue(connectionStatus() as any);

      await logoutManaged(MANAGED_PROVIDER_FIXTURE as any);
      await vi.advanceTimersByTimeAsync(0);

      expect(hybridControlPlane.logoutCopilot).toHaveBeenCalledTimes(1);
      expect(hybridControlPlane.getCopilotStatus).toHaveBeenCalledTimes(1);
      expect(useWorkspaceStore.getState().providerStatus["github-copilot"]?.kind).toBe("unauthenticated");
    });

    it("a login supersedes whatever poll timer was already scheduled -- it doesn't wait for it", async () => {
      vi.mocked(hybridControlPlane.getCopilotStatus).mockResolvedValue(connectionStatus() as any);
      startProviderCoordinator();
      await vi.advanceTimersByTimeAsync(0);
      // First poll settled "disconnected" -> background cadence (minutes
      // away). Without forcePollNow, a login here would sit unconfirmed
      // until that far-off timer fires.
      vi.mocked(hybridControlPlane.getCopilotStatus).mockClear();
      vi.mocked(hybridControlPlane.startCopilotLogin).mockResolvedValue(connectionStatus({ state: "connecting" }) as any);
      vi.mocked(hybridControlPlane.getCopilotStatus).mockResolvedValue(connectionStatus({ state: "connecting" }) as any);

      await startManagedLogin(MANAGED_PROVIDER_FIXTURE as any);
      await vi.advanceTimersByTimeAsync(0);

      expect(hybridControlPlane.getCopilotStatus).toHaveBeenCalledTimes(1);
      expect(useWorkspaceStore.getState().providerStatus["github-copilot"]?.kind).toBe("loading");
    });

    it("defers Claude Code browser authorization notification until verificationUri is available after download", async () => {
      useNotificationStore.getState().clear();
      const CLAUDE_PROVIDER = {
        id: "anthropic-claude-code",
        name: "Claude Code",
        transport: "anthropic-claude-agent-sdk",
      };

      vi.mocked(hybridControlPlane.startClaudeCodeLogin).mockResolvedValue(connectionStatus({ state: "connecting" }) as any);
      // First check during download: no verificationUri, downloading message
      vi.mocked(hybridControlPlane.getClaudeCodeStatus).mockResolvedValue({
        state: "connecting",
        authenticated: false,
        message: "Downloading and installing the integration runtime. This may take a few minutes...",
      } as any);

      startProviderCoordinator();
      await startManagedLogin(CLAUDE_PROVIDER as any);
      await vi.advanceTimersByTimeAsync(0);

      // Status is loading, but no notification yet because download is in progress
      expect(useWorkspaceStore.getState().providerStatus["anthropic-claude-code"]).toMatchObject({
        kind: "loading",
        verificationUri: undefined,
      });
      expect(useNotificationStore.getState().notification).toBeNull();

      // Download finishes, CLI spawns, outputs verificationUri
      vi.mocked(hybridControlPlane.getClaudeCodeStatus).mockResolvedValue({
        state: "connecting",
        authenticated: false,
        verificationUri: "https://claude.com/oauth/authorize?test=1",
      } as any);

      // Advance fast-poll timer (1s)
      await vi.advanceTimersByTimeAsync(FAST_POLL_INTERVAL_MS);

      // Notification now arrives
      expect(useWorkspaceStore.getState().providerStatus["anthropic-claude-code"]).toMatchObject({
        kind: "loading",
        verificationUri: "https://claude.com/oauth/authorize?test=1",
      });
      expect(useNotificationStore.getState().notification).toMatchObject({
        title: "Anthropic authorization",
        message: "Complete the Claude Code sign-in flow in your browser.",
        variant: "info",
      });

      // Clear notification and advance timer again -- it should not notify a second time
      useNotificationStore.getState().clear();
      await vi.advanceTimersByTimeAsync(FAST_POLL_INTERVAL_MS);
      expect(useNotificationStore.getState().notification).toBeNull();
    });

    it("cancels pending authorization notification when login is cancelled before download finishes", async () => {
      useNotificationStore.getState().clear();
      const CLAUDE_PROVIDER = {
        id: "anthropic-claude-code",
        name: "Claude Code",
        transport: "anthropic-claude-agent-sdk",
      };

      vi.mocked(hybridControlPlane.startClaudeCodeLogin).mockResolvedValue(connectionStatus({ state: "connecting" }) as any);
      vi.mocked(hybridControlPlane.getClaudeCodeStatus).mockResolvedValue({
        state: "connecting",
        authenticated: false,
        message: "Downloading and installing the integration runtime...",
      } as any);

      await startManagedLogin(CLAUDE_PROVIDER as any);
      await vi.advanceTimersByTimeAsync(0);
      expect(useNotificationStore.getState().notification).toBeNull();

      // User cancels while downloading
      vi.mocked(hybridControlPlane.getClaudeCodeStatus).mockResolvedValue(connectionStatus({ state: "disconnected" }) as any);
      await cancelManagedLogin(CLAUDE_PROVIDER as any);
      await vi.advanceTimersByTimeAsync(0);

      expect(useNotificationStore.getState().notification).toBeNull();
    });
  });

  describe("normalizeClaudeAuthCode", () => {
    it("preserves already formatted code#state", () => {
      expect(normalizeClaudeAuthCode("code123#state456")).toBe("code123#state456");
      expect(normalizeClaudeAuthCode("  code123#state456  ")).toBe("code123#state456");
    });

    it("normalizes callback url with hash fragment", () => {
      const url = "https://platform.claude.com/oauth/code/callback#code=cai_code_999&state=state_xyz";
      expect(normalizeClaudeAuthCode(url)).toBe("cai_code_999#state_xyz");
    });

    it("normalizes callback url with query parameters", () => {
      const url = "https://claude.ai/oauth/code/callback?code=cai_code_999&state=state_xyz";
      expect(normalizeClaudeAuthCode(url)).toBe("cai_code_999#state_xyz");
    });

    it("normalizes key-value query string", () => {
      expect(normalizeClaudeAuthCode("code=cai_code_999&state=state_xyz")).toBe("cai_code_999#state_xyz");
    });

    it("returns trimmed string when not matching oauth patterns", () => {
      expect(normalizeClaudeAuthCode("   raw_code   ")).toBe("raw_code");
      expect(normalizeClaudeAuthCode("")).toBe("");
    });
  });

  describe("submitManagedAuthCode / cancelManagedLogin", () => {
    const CLAUDE_PROVIDER_FIXTURE = {
      id: "anthropic-claude-code",
      name: "Claude Code",
      baseUrl: "https://api.anthropic.com",
      apiKey: "",
      apiType: "anthropic-messages",
      authType: "none" as const,
      models: [],
    };

    it("submits normalized code to managedAuthSubmitCode and re-polls status", async () => {
      vi.mocked(managedAuthSubmitCode).mockResolvedValue(undefined);
      vi.mocked(hybridControlPlane.getClaudeCodeStatus).mockResolvedValue(connectionStatus({ state: "connecting" }) as any);

      await submitManagedAuthCode(
        CLAUDE_PROVIDER_FIXTURE as any,
        "https://platform.claude.com/oauth/code/callback#code=code_1&state=state_2",
      );
      await vi.advanceTimersByTimeAsync(0);

      expect(managedAuthSubmitCode).toHaveBeenCalledWith("claude-code", "code_1#state_2");
      expect(hybridControlPlane.getClaudeCodeStatus).toHaveBeenCalledTimes(1);
    });

    it("cancels login via managedAuthCancelLogin and re-polls status", async () => {
      vi.mocked(managedAuthCancelLogin).mockResolvedValue(undefined);
      vi.mocked(hybridControlPlane.getClaudeCodeStatus).mockResolvedValue(connectionStatus({ state: "disconnected" }) as any);

      await cancelManagedLogin(CLAUDE_PROVIDER_FIXTURE as any);
      await vi.advanceTimersByTimeAsync(0);

      expect(managedAuthCancelLogin).toHaveBeenCalledWith("claude-code");
      expect(hybridControlPlane.getClaudeCodeStatus).toHaveBeenCalledTimes(1);
    });

    it("rejects submit/cancel for non-managed providers", async () => {
      await expect(submitManagedAuthCode(REGULAR_PROVIDER_WITH_KEY as any, "code#state")).rejects.toThrow(/not one of the managed-auth providers/);
      await expect(cancelManagedLogin(REGULAR_PROVIDER_WITH_KEY as any)).rejects.toThrow(/not one of the managed-auth providers/);
    });
  });
});
