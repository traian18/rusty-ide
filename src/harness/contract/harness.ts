// ============================================================
// harness.ts — The one interface the UI depends on.
//
// A backend (SidecarHarness, CoreHarness) implements AgentHarness directly;
// HarnessRouter also implements it and dispatches to whichever backend a
// capability is routed to, so a component never has to know which one it's
// talking to.
// ============================================================

import type { CapabilityEvent, CapabilityInput, CapabilityName } from "./capabilities";
import type { TokenUsage } from "./events";
import type { RunHandle } from "./run";
import type { RunHost } from "./host";
import type { ExecutionOrigin } from "./observability";

export interface AgentHarness {
  readonly id: string;

  /** Whether this backend can run `capability` at all, given `input` (e.g. a
   * managed-CLI provider that only the sidecar currently authenticates).
   * Consulted by HarnessRouter before dispatching; a backend that always
   * supports everything it implements can just `return true`. */
  supports<K extends CapabilityName>(capability: K, input: CapabilityInput<K>): boolean;

  run<K extends CapabilityName>(
    capability: K,
    input: CapabilityInput<K>,
    host: RunHost,
    onEvent: (event: CapabilityEvent<K>) => void,
    origin?: Partial<ExecutionOrigin>,
  ): RunHandle<K>;

  /** Taps every run's usage events, across capabilities -- replaces
   * agentHarnessClient.subscribeAll's use by createMetricsSlice. */
  subscribeUsage(listener: (runId: string, usage: TokenUsage) => void): () => void;

  /** Releases any backend-side resources associated with a long-lived UI
   * session key (e.g. an Agent tab id) once its tab closes -- replaces the
   * raw `command_session_close` send in AgentTab.tsx. A backend with no such
   * resources (e.g. one run per session key, cleaned up on completion) can
   * no-op. */
  releaseSession(sessionKey: string): Promise<void>;
}
