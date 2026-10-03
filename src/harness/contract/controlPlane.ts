// ============================================================
// controlPlane.ts — The non-run harness surface: provider discovery/auth/
// quota and usage recording. Distinct from AgentHarness (which is only
// about capability runs) because these operations have no run id, no
// event stream, and no host -- they're request/response calls a settings
// surface or provider coordinator makes directly.
//
// Sidecar-removal Phase 8c: these method signatures used to be inherited
// via `extends IntegrationControlPlane` (src/services/llmIntegrationService.ts,
// the sidecar's own HTTP client) -- that file, and the whole sidecar it
// talked to, are gone. The shapes are unchanged (still provider-specific,
// still not harness-contract vocabulary in spirit), just declared directly
// here now that there's no separate "integration service" implementation
// left to name a shared interface after. `HybridControlPlane.ts` (renamed
// in spirit, not in name -- see its own doc comment) is the sole
// implementation.
//
// `testMcp` is gone too -- nothing calls it any more.
// `mcpTestConnection.ts`'s `testMcpConnection` is its real replacement
// (Phase 7b), called directly by connection-test.ts, never through this
// interface at all (no provider-specific behavior to dispatch on, same
// reasoning `recordUsage` below already established).
// ============================================================

import type { CustomProvider, ProviderModel, ProviderQuotaSnapshot } from "../../store/types";

export interface CopilotConnectionStatus {
  state: "disconnected" | "connecting" | "connected" | "failed";
  authenticated: boolean;
  authType?: string;
  host?: string;
  login?: string;
  message?: string;
  verificationUri?: string;
  userCode?: string;
  diagnostics?: string[];
}

export interface CodexConnectionStatus {
  state: "disconnected" | "connecting" | "connected" | "failed";
  authenticated: boolean;
  authType?: string;
  email?: string;
  planType?: string;
  message?: string;
  verificationUri?: string;
  userCode?: string;
  diagnostics?: string[];
}

export interface UsageRecordSample {
  workspaceRoot: string;
  surface: string;
  runId?: string;
  tabId?: string;
  provider?: string;
  model: string;
  usage: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    reasoning?: number;
    totalTokens: number;
  };
  /** `false` when the sample continues a model request an earlier sample
   * already counted, so the metrics count requests, not samples. */
  newRequest?: boolean;
}

export interface HarnessControlPlane {
  discoverModels(provider: CustomProvider): Promise<ProviderModel[]>;
  testConnection(provider: CustomProvider): Promise<{ modelCount: number; supportedModelCount: number }>;
  /** Separate inference capability test: checks if the provider can process
   * requests without requiring catalog discovery. Returns success status and
   * optional error message for UI display. */
  testInference(provider: CustomProvider): Promise<{ success: boolean; message?: string }>;
  getQuota(provider: CustomProvider): Promise<ProviderQuotaSnapshot>;
  getCopilotStatus(): Promise<CopilotConnectionStatus>;
  startCopilotLogin(): Promise<CopilotConnectionStatus>;
  logoutCopilot(): Promise<CopilotConnectionStatus>;
  getCodexStatus(): Promise<CodexConnectionStatus>;
  startCodexLogin(): Promise<CodexConnectionStatus>;
  logoutCodex(): Promise<CodexConnectionStatus>;
  /** Records one incremental usage sample into .rusty/metrics (not a
   * cumulative total) via the `record_usage` Tauri command
   * (src-tauri/src/usage_tracking.rs) -- see HybridControlPlane.ts's own
   * doc comment for why this is unconditional, not dispatched. */
  recordUsage(sample: UsageRecordSample): Promise<void>;
}
