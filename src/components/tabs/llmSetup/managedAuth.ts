import type { CustomProvider, ProviderStatus } from "../../../store";
import { isCodexProvider } from "../../../store/providerHelpers";

/** The words and links that differ between the Copilot and Codex sign-in flows. */
export interface ManagedAuthCopy {
  vendor: string;
  product: string;
  accountHint: string;
  credentialNote: string;
  /** Opened when the sign-in status carries a device code but no page of its own. */
  verificationFallback: string;
}

const CODEX_COPY: ManagedAuthCopy = {
  vendor: "OpenAI",
  product: "Codex",
  accountHint: "Use the OpenAI account connected to your Codex plan.",
  credentialNote: "The official Codex app-server manages credentials in the same ~/.codex account used by Codex CLI/Desktop. Rusty never stores the OAuth token in provider settings.",
  verificationFallback: "https://auth.openai.com/codex/device",
};

const COPILOT_COPY: ManagedAuthCopy = {
  vendor: "GitHub",
  product: "Copilot",
  accountHint: "Use the GitHub account that owns your Copilot subscription.",
  credentialNote: "GitHub Copilot CLI manages credentials, using the system credential store when available. Rusty never stores the OAuth token in provider settings.",
  verificationFallback: "https://github.com/login/device",
};

/** Copy for a managed-auth provider: Codex, otherwise Copilot. */
export function managedAuthCopy(provider: CustomProvider): ManagedAuthCopy {
  return isCodexProvider(provider) ? CODEX_COPY : COPILOT_COPY;
}

export function managedStatusDotClass(status: ProviderStatus): string {
  if (status.kind === "ready") return "bg-[var(--color-status-success)]";
  if (status.kind === "loading") return "bg-[var(--color-status-warning)] animate-pulse";
  return "bg-[var(--text-muted)]";
}

export function managedHeadline(status: ProviderStatus, vendor: string): string {
  if (status.kind === "loading") return `Connecting to ${vendor}`;
  if (status.kind === "ready") return status.account ? `Connected as ${status.account}` : "Connected";
  return `${vendor} sign-in required`;
}

export function signInButtonLabel(status: ProviderStatus, vendor: string): string {
  if (status.kind === "loading") return "Signing in…";
  if (status.kind === "ready") return "Re-authenticate";
  return `Sign in with ${vendor}`;
}

/** A sign-in is under way and has a device code or a sign-in page to show. */
export function awaitsDeviceSignIn(status: ProviderStatus): boolean {
  if (status.kind !== "loading") return false;
  return Boolean(status.userCode || status.verificationUri);
}

export function verificationPage(status: ProviderStatus, copy: ManagedAuthCopy): string {
  return status.verificationUri || copy.verificationFallback;
}
