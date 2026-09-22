// ============================================================
// managedAuthClient.ts — Thin TypeScript client over the
// managed_auth_{status,start_login,login_status,logout,quota,models} Tauri
// commands (src-tauri/src/harness/managed_auth.rs and managed_quota.rs,
// wired into commands.rs). Plain
// exported functions, not a class: these are one-off admin/settings calls
// unrelated to a CoreHarness run's own session lifecycle, so they don't
// belong on CoreEngineClient (which mirrors the session-scoped RPC surface
// only -- see its own doc comment on why listProviders/listModels are the
// only other non-session methods there).
//
// `LoginState`'s fields mirror managed_auth.rs's own `LoginState` struct
// verbatim (plain #[derive(Serialize)], no camelCase rename -- see that
// struct's own field names) -- snake_case return values are this project's
// existing convention for Tauri command results (e.g. CoreEngineClient's
// own `protocol_version`), even though invoke() *arguments* are camelCased.
// ============================================================

import { invoke } from "@tauri-apps/api/core";

export type ManagedAuthProvider = "codex" | "claude-code" | "github-copilot";

export interface LoginState {
  /** `null` when this provider has no reliable plain-CLI way to check
   * (GitHub Copilot -- see managed_auth.rs's own doc comment) or a check
   * hasn't completed yet. */
  authenticated: boolean | null;
  message: string;
  verification_uri: string | null;
  user_code: string | null;
  in_progress: boolean;
  account?: string | null;
}

/** On-demand "is this provider currently authenticated" check. */
export function managedAuthStatus(provider: ManagedAuthProvider): Promise<LoginState> {
  return invoke("managed_auth_status", { provider });
}

/** Starts a login attempt in the background; resolves once the attempt is
 * *launched*, not once it completes -- poll `managedAuthLoginStatus` for
 * progress (device code, completion), matching the existing sidecar-backed
 * Copilot/Codex/Claude Code login cards' own polling UX. */
export function managedAuthStartLogin(provider: ManagedAuthProvider): Promise<void> {
  return invoke("managed_auth_start_login", { provider });
}

/** Reads the current in-flight/last-known login state -- call this on an
 * interval while a login is in progress. */
export function managedAuthLoginStatus(provider: ManagedAuthProvider): Promise<LoginState> {
  return invoke("managed_auth_login_status", { provider });
}

/** Rejects for GitHub Copilot (no plain CLI logout subcommand exists --
 * see managed_auth.rs's own doc comment) with an explanatory message. */
export function managedAuthLogout(provider: ManagedAuthProvider): Promise<void> {
  return invoke("managed_auth_logout", { provider });
}

/** Submits user input (e.g. Claude Code's browser confirmation code) to the in-flight login process's stdin. */
export function managedAuthSubmitCode(provider: ManagedAuthProvider, code: string): Promise<void> {
  return invoke("managed_auth_submit_code", { provider, code });
}

/** Cancels an in-flight login attempt, aborting its child process. */
export function managedAuthCancelLogin(provider: ManagedAuthProvider): Promise<void> {
  return invoke("managed_auth_cancel_login", { provider });
}

/** managed_quota.rs's `ManagedQuota` -- the provider's raw quota payload,
 * shaped into a `ProviderQuotaSnapshot` by managedQuota.ts. */
export interface ManagedQuota {
  authenticated: boolean;
  account?: string;
  plan?: string;
  /** Why `data` is absent (not signed in, an auth method with no quota
   * endpoint, a fetch that failed after sign-in was confirmed). */
  message?: string;
  /** Copilot: `{quotaSnapshots, quotaResetDate}`; Codex: the
   * `account/rateLimits/read` result; Claude Code: the `/api/oauth/usage`
   * body. */
  data?: unknown;
}

/** Reads the provider's subscription quota from its own vendored CLI (a
 * one-shot subprocess per call -- see managed_quota.rs). Rejects when the
 * CLI can't be started or doesn't answer; a signed-out provider resolves
 * with `authenticated: false` instead. */
export function managedAuthQuota(provider: ManagedAuthProvider): Promise<ManagedQuota> {
  return invoke("managed_auth_quota", { provider });
}

export interface ManagedModel {
  id: string;
  name: string;
  reasoning: boolean;
  supportedReasoningEfforts?: string[];
  defaultReasoningEffort?: string;
  input?: Array<"text" | "image">;
  contextWindow?: number;
  maxTokens?: number;
  isDefault: boolean;
}

/** Reads the account-aware model catalog from the managed runtime. */
export function managedAuthModels(provider: ManagedAuthProvider): Promise<ManagedModel[]> {
  return invoke("managed_auth_models", { provider });
}
