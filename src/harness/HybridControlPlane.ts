// ============================================================
// HybridControlPlane.ts — The sole `HarnessControlPlane` implementation.
// `discoverModels`/`testConnection`/`getQuota` answer directly via
// providerCatalog.ts for an HTTP-transport provider. For a managed-auth
// provider (Copilot/Codex/Claude Code), `getQuota` goes to
// managed_quota.rs via `managedAuthQuota` (each CLI asked directly, no
// SDK -- see that module) and is shaped by managedQuota.ts; the other two
// still reject with a clear, honest error (sidecar-removal Phase 8c --
// see below).
//
// `recordUsage` calls `record_usage` (src-tauri/src/usage_tracking.rs)
// directly, unconditionally -- there's no provider-specific behavior to
// preserve for writing a usage sample.
//
// The 9 managed-provider status/login/logout methods (get/start/logout x
// Copilot/Codex/ClaudeCode) call `managedAuthClient.ts`'s Rust-backed
// commands (`managed_auth.rs`, Phase 3) -- `loginStateToConnectionStatus`
// adapts `managed_auth.rs`'s `LoginState` (authenticated/message/
// verification_uri/user_code/in_progress) into the richer Copilot/Codex-
// shaped status objects `providerCoordinator.ts`/`LlmSetupTab.tsx`/
// `ManagedAuthSettings.tsx` all already expect; fields with no Rust-side
// equivalent (authType/host/login/email/planType/diagnostics) are simply
// omitted, all optional on both target types.
//
// Sidecar-removal Phase 8c: this file used to be a genuine dispatcher
// ("Hybrid") between a direct path and a sidecar fallback -- the sidecar,
// and everything under src/harness/sidecar/, is gone now. Kept the
// "Hybrid" name (renaming would just be unrelated churn across index.ts/
// providerCoordinator.ts/LlmSetupTab.tsx/tests) since there's still a real
// dispatch inside for the provider-catalog methods (direct HTTP vs. a
// clear rejection for managed providers). `discoverModels`/`testConnection`
// for a managed provider are a REAL, ACCEPTED regression from removing the
// sidecar (confirmed live in LlmSetupTab.tsx that "Load Models" for
// Copilot/Codex/Claude Code was real functionality) -- rusty-core's own
// subprocess integrations expose no live model-list RPC to answer it with,
// and fabricating a static model catalog was rejected as more likely to
// ship silently wrong data than to help (see the sidecar-removal plan
// doc's Phase 7c notes). These two throw a clear error instead of reaching
// into deleted sidecar code. `getQuota` was on that list too until
// 2026-09-18, when it turned out the vendored CLIs answer it directly
// (managed_quota.rs) -- the sidecar's SDKs were never load-bearing there.
//
// No more dependency-injection factory: the singleton-leak bug that
// motivated `createHybridControlPlane({sidecar})` was specifically about
// `vi.spyOn` against the real `sidecarControlPlane` object (gone); this
// file's own logic is either a pure `fetch` (mockable via `vi.spyOn(global,
// "fetch")`) or an `invoke` call (mockable via the existing `@tauri-apps/
// api/core` module mock), neither of which has that shared-singleton risk.
// ============================================================

import { invoke } from "@tauri-apps/api/core";

import { discoverProviderModelsDirect, fetchProviderQuotaDirect, testProviderConnectionDirect } from "./core/engine/providerCatalog";
import type {
  ClaudeCodeConnectionStatus,
  CodexConnectionStatus,
  CopilotConnectionStatus,
  HarnessControlPlane,
  UsageRecordSample,
} from "./contract/controlPlane";
import { managedAuthLogout, managedAuthQuota, managedAuthStartLogin, managedAuthStatus, type LoginState, type ManagedAuthProvider } from "./managedAuthClient";
import { mapManagedQuota } from "./managedQuota";
import { isClaudeCodeProvider, isCodexProvider, isCopilotProvider, isManagedAuthProvider } from "../store/providerHelpers";
import type { CustomProvider, ProviderModel, ProviderQuotaSnapshot } from "../store/types";

function loginStateToConnectionStatus(state: LoginState): CopilotConnectionStatus & CodexConnectionStatus {
  const authenticated = state.authenticated === true;
  return {
    state: state.in_progress ? "connecting" : authenticated ? "connected" : "disconnected",
    authenticated,
    message: state.message,
    verificationUri: state.verification_uri ?? undefined,
    userCode: state.user_code ?? undefined,
    login: state.account ?? undefined,
  };
}

/** `start*Login`/`logout*`'s only real caller, `providerCoordinator.ts`'s
 * `startManagedLogin`/`logoutManaged`, discards their return value entirely
 * (only checks for a thrown error) and immediately re-polls the real status
 * via `forcePollNow` right after -- so these return a synthetic placeholder
 * rather than an extra `managedAuthStatus` round trip that would just be
 * overwritten a moment later. */
const CONNECTING_PLACEHOLDER = loginStateToConnectionStatus({ authenticated: false, message: "", verification_uri: null, user_code: null, in_progress: true });
const DISCONNECTED_PLACEHOLDER = loginStateToConnectionStatus({ authenticated: false, message: "", verification_uri: null, user_code: null, in_progress: false });

/** Mirrors `providerHelpers.ts`'s own `isManagedAuthProvider` check (not
 * just `provider.transport`): a managed provider can be identified by its
 * well-known `id` alone even with no `transport` set (e.g. an older saved
 * config, or a provider seeded before `transport` existed) -- the same
 * dual check `providerCoordinator.ts`'s own managed-provider handling
 * already relies on. */
function isDirectlyReachable(provider: CustomProvider): boolean {
  return !isManagedAuthProvider(provider) && (!provider.transport || provider.transport === "http");
}

function managedProviderUnsupported(method: string, provider: CustomProvider): Error {
  return new Error(
    `${method}() is not available for managed-auth provider '${provider.id}' -- rusty-core's own Codex/Claude Code/GitHub Copilot ` +
      "integrations expose no live model-list RPC, and this became a real, accepted gap when the Node sidecar (which used " +
      "to answer this) was removed. Status/login/logout/quota still work normally.",
  );
}

/** The managed_auth.rs/managed_quota.rs integration id for a managed
 * provider (the store's own ids differ: `openai-codex`, `anthropic-claude-
 * code`), or undefined for anything else. */
function managedIntegrationId(provider: CustomProvider): ManagedAuthProvider | undefined {
  if (isCopilotProvider(provider)) return "github-copilot";
  if (isCodexProvider(provider)) return "codex";
  if (isClaudeCodeProvider(provider)) return "claude-code";
  return undefined;
}

export function createHybridControlPlane(): HarnessControlPlane {
  return {
    async discoverModels(provider: CustomProvider): Promise<ProviderModel[]> {
      if (isDirectlyReachable(provider)) return discoverProviderModelsDirect(provider);
      throw managedProviderUnsupported("discoverModels", provider);
    },

    async testConnection(provider: CustomProvider): Promise<{ modelCount: number; supportedModelCount: number }> {
      if (isDirectlyReachable(provider)) return testProviderConnectionDirect(provider);
      throw managedProviderUnsupported("testConnection", provider);
    },

    async getQuota(provider: CustomProvider): Promise<ProviderQuotaSnapshot> {
      if (isDirectlyReachable(provider)) return fetchProviderQuotaDirect(provider);
      const integration = managedIntegrationId(provider);
      if (!integration) throw managedProviderUnsupported("getQuota", provider);
      return mapManagedQuota(provider, await managedAuthQuota(integration));
    },

    async recordUsage(sample: UsageRecordSample): Promise<void> {
      const { workspaceRoot, ...entry } = sample;
      await invoke("record_usage", { workspaceRoot, entry });
    },

    async getCopilotStatus(): Promise<CopilotConnectionStatus> {
      return loginStateToConnectionStatus(await managedAuthStatus("github-copilot"));
    },
    async startCopilotLogin(): Promise<CopilotConnectionStatus> {
      await managedAuthStartLogin("github-copilot");
      return CONNECTING_PLACEHOLDER;
    },
    async logoutCopilot(): Promise<CopilotConnectionStatus> {
      await managedAuthLogout("github-copilot");
      return DISCONNECTED_PLACEHOLDER;
    },

    async getCodexStatus(): Promise<CodexConnectionStatus> {
      return loginStateToConnectionStatus(await managedAuthStatus("codex"));
    },
    async startCodexLogin(): Promise<CodexConnectionStatus> {
      await managedAuthStartLogin("codex");
      return CONNECTING_PLACEHOLDER;
    },
    async logoutCodex(): Promise<CodexConnectionStatus> {
      await managedAuthLogout("codex");
      return DISCONNECTED_PLACEHOLDER;
    },

    async getClaudeCodeStatus(): Promise<ClaudeCodeConnectionStatus> {
      return loginStateToConnectionStatus(await managedAuthStatus("claude-code"));
    },
    async startClaudeCodeLogin(): Promise<ClaudeCodeConnectionStatus> {
      await managedAuthStartLogin("claude-code");
      return CONNECTING_PLACEHOLDER;
    },
    async logoutClaudeCode(): Promise<ClaudeCodeConnectionStatus> {
      await managedAuthLogout("claude-code");
      return DISCONNECTED_PLACEHOLDER;
    },
  };
}

export const hybridControlPlane: HarnessControlPlane = createHybridControlPlane();
