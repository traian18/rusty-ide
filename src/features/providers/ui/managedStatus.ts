import type { CodexConnectionStatus, CopilotConnectionStatus } from "../../../harness/contract/controlPlane";
import type { ProviderStatus } from "../../../store/types";

export const MANAGED_PROVIDER_IDS = ["github-copilot", "openai-codex"] as const;
export type ManagedProviderId = (typeof MANAGED_PROVIDER_IDS)[number];

export type ManagedStatus = CopilotConnectionStatus | CodexConnectionStatus;

/** CopilotConnectionStatus reports `login`/`host`; Codex reports
 * `email`/`planType` -- accessed via a loose cast rather than an `in`
 * narrowing on the union, which TS accepts either way but this is more
 * obviously correct at a glance. */
function accountLabel(status: ManagedStatus): string | undefined {
  const asAny = status as { login?: string; email?: string };
  return asAny.login || asAny.email || undefined;
}

function providerDetails(status: ManagedStatus): { host?: string; planType?: string } {
  const asAny = status as { host?: string; planType?: string };
  return { host: asAny.host, planType: asAny.planType };
}

/**
 * Exported for direct unit testing -- the mapping from the sidecar's
 * {state, authenticated, ...} shape to the registry's ProviderStatusKind is
 * the one piece of this module worth pinning without going through the
 * timer/network machinery around it.
 */
export function mapManagedStatus(status: ManagedStatus): ProviderStatus {
  const checkedAt = new Date().toISOString();
  const shared = {
    checkedAt,
    message: status.message,
    diagnostics: status.diagnostics,
  };
  switch (status.state) {
    case "connected":
      return { ...shared, kind: "ready", account: accountLabel(status), ...providerDetails(status) };
    case "connecting":
      // Unauthenticated to start (no code yet), then filled in as the
      // sidecar's own module-global login attempt progresses -- Copilot's
      // device code specifically only ever arrives via a LATER poll
      // (agent-sidecar/src/services/copilotService.ts), never the login
      // response itself.
      return { ...shared, kind: "loading", verificationUri: status.verificationUri, userCode: status.userCode };
    case "disconnected":
      return { ...shared, kind: "unauthenticated" };
    case "failed":
      return { ...shared, kind: "error" };
  }
}

export function isManagedProviderId(id: string): id is ManagedProviderId {
  return (MANAGED_PROVIDER_IDS as readonly string[]).includes(id);
}
