import { useCallback, useEffect, useRef, useState } from "react";
import { Copy, ExternalLink } from "lucide-react";
import {
  managedAuthLoginStatus,
  managedAuthLogout,
  managedAuthStartLogin,
  managedAuthStatus,
  type LoginState,
  type ManagedAuthProvider,
} from "../../harness/managedAuthClient";
import styles from "./ManagedAuthSettings.module.css";

/**
 * Settings card for the core-routed (rusty-core subprocess) Codex/Claude
 * Code/GitHub Copilot integrations -- see HARNESS_CONTRACT_PLAN.md's
 * Phase 3 plan notes for why this is a *separate*, additive card rather
 * than a change to LlmSetupTab's existing sidecar-backed managed-provider
 * UI: the two are independently routable (a provider can be signed in via
 * either path -- they share the same on-disk/keychain credential state,
 * since both ultimately drive the same CLI binaries), and a user who never
 * routes a capability to "core" never needs to see this at all.
 */
const PROVIDERS: Array<{ id: ManagedAuthProvider; name: string; vendor: string; verificationFallback: string }> = [
  { id: "codex", name: "OpenAI Codex", vendor: "OpenAI", verificationFallback: "https://auth.openai.com/codex/device" },
  { id: "claude-code", name: "Claude Code", vendor: "Anthropic", verificationFallback: "" },
  { id: "github-copilot", name: "GitHub Copilot", vendor: "GitHub", verificationFallback: "https://github.com/login/device" },
];

const POLL_INTERVAL_MS = 2_000;
const DEFAULT_STATE: LoginState = { authenticated: null, message: "Checking…", verification_uri: null, user_code: null, in_progress: false };

function statusDotClass(state: LoginState): string {
  if (state.in_progress) return styles.statusDotLoading;
  if (state.authenticated === true) return styles.statusDotReady;
  if (state.authenticated === false) return styles.statusDotError;
  return styles.statusDot;
}

function statusLabel(state: LoginState): string {
  if (state.in_progress) return "Signing in…";
  if (state.authenticated === true) return "Connected";
  if (state.authenticated === false) return "Not signed in";
  return "Unknown";
}

function ProviderCard({ provider }: { provider: (typeof PROVIDERS)[number] }) {
  const [state, setState] = useState<LoginState>(DEFAULT_STATE);
  const [loggingOut, setLoggingOut] = useState(false);
  const [actionError, setActionError] = useState<string | undefined>();
  const pollRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined);

  const stopPolling = useCallback(() => {
    if (pollRef.current !== undefined) {
      clearInterval(pollRef.current);
      pollRef.current = undefined;
    }
  }, []);

  const refresh = useCallback(async () => {
    try {
      const next = await managedAuthStatus(provider.id);
      setState(next);
    } catch (error) {
      setState({
        authenticated: null,
        message: error instanceof Error ? error.message : "Status check failed.",
        verification_uri: null,
        user_code: null,
        in_progress: false,
      });
    }
  }, [provider.id]);

  useEffect(() => {
    void refresh();
    return stopPolling;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [provider.id]);

  const pollUntilSettled = useCallback(() => {
    stopPolling();
    pollRef.current = setInterval(() => {
      void (async () => {
        const next = await managedAuthLoginStatus(provider.id);
        setState(next);
        if (!next.in_progress) stopPolling();
      })();
    }, POLL_INTERVAL_MS);
  }, [provider.id, stopPolling]);

  const handleLogin = useCallback(async () => {
    setActionError(undefined);
    setState((previous) => ({ ...previous, in_progress: true, message: "Starting login…" }));
    try {
      await managedAuthStartLogin(provider.id);
      pollUntilSettled();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Could not start login.");
      setState((previous) => ({ ...previous, in_progress: false }));
    }
  }, [provider.id, pollUntilSettled]);

  const handleLogout = useCallback(async () => {
    setActionError(undefined);
    setLoggingOut(true);
    try {
      await managedAuthLogout(provider.id);
      await refresh();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Could not sign out.");
    } finally {
      setLoggingOut(false);
    }
  }, [provider.id, refresh]);

  const handleCopyCode = useCallback(() => {
    if (state.user_code) void navigator.clipboard.writeText(state.user_code);
  }, [state.user_code]);

  const verificationUri = state.verification_uri || provider.verificationFallback;

  return (
    <div className={styles.card}>
      <div className={styles.cardHeader}>
        <div className={styles.statusRow}>
          <div className={`${styles.statusDot} ${statusDotClass(state)}`} />
          <div>
            <div className={styles.label}>
              {provider.name} — {statusLabel(state)}
            </div>
            <p className={styles.hint}>{actionError || state.message}</p>
          </div>
        </div>
        <div className={styles.actions}>
          {state.authenticated === true && (
            <button
              type="button"
              className={`${styles.button} ${styles.buttonDanger}`}
              disabled={loggingOut}
              onClick={() => void handleLogout()}
            >
              {loggingOut ? "Signing out…" : "Sign Out"}
            </button>
          )}
          <button
            type="button"
            className={`${styles.button} ${styles.buttonPrimary}`}
            disabled={state.in_progress}
            onClick={() => void handleLogin()}
          >
            {state.in_progress ? "Signing in…" : state.authenticated === true ? "Re-authenticate" : `Sign in with ${provider.vendor}`}
          </button>
        </div>
      </div>
      {state.in_progress && state.user_code && (
        <div className={styles.deviceCode}>
          <div className={styles.deviceCodeLabel}>{provider.vendor} device code</div>
          <button type="button" className={styles.deviceCodeValue} onClick={handleCopyCode} title="Copy device code">
            {state.user_code}
          </button>
          <div style={{ display: "flex", gap: "var(--space-2)" }}>
            <button type="button" className={styles.button} onClick={handleCopyCode}>
              <Copy size={12} /> Copy Code
            </button>
            {verificationUri && (
              <a
                href={verificationUri}
                target="_blank"
                rel="noreferrer"
                className={`${styles.button} ${styles.buttonPrimary}`}
                style={{ display: "inline-flex", alignItems: "center", gap: "0.4em", textDecoration: "none" }}
              >
                <ExternalLink size={12} /> Open {provider.vendor}
              </a>
            )}
          </div>
          {verificationUri && <p className={styles.deviceCodeUri}>{verificationUri}</p>}
        </div>
      )}
    </div>
  );
}

/**
 * HARNESS_CONTRACT_PLAN.md Phase 3: login/status/logout for the three
 * managed-auth providers when routed to rusty-core's own subprocess
 * integrations (managed_auth.rs) instead of the Node sidecar. Reads/writes
 * nothing in the Zustand store -- unlike providerCoordinator.ts's sidecar-
 * backed polling (which feeds the shared provider registry every other
 * surface reads), this card owns its own local per-provider state, since
 * nothing else in the app currently needs to know about core-routed
 * managed-auth status.
 */
export function ManagedAuthSettings() {
  return (
    <section className={styles.section} aria-labelledby="managed-auth-title">
      <div className={styles.heading}>
        <div>
          <h3 className={styles.title} id="managed-auth-title">Managed-auth providers (embedded engine)</h3>
          <p className={styles.description}>
            Sign in to Codex, Claude Code, or GitHub Copilot for capabilities routed to the embedded engine. These
            share the same on-disk/keychain credentials as the sidecar-based sign-in above -- signing in here or
            there authenticates both.
          </p>
        </div>
      </div>
      {PROVIDERS.map((provider) => (
        <ProviderCard key={provider.id} provider={provider} />
      ))}
    </section>
  );
}
