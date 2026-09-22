// ============================================================
// errors.ts — The one error shape a capability run's failed outcome
// carries, independent of which backend produced it.
//
// Deliberately not imported from shared/agent-protocol/errors.ts (see
// host.ts's note on the same boundary): a core-backed run has no protocol-
// or RPC-level error codes to report, only "the backend failed" plus a
// message. `code` stays a plain string rather than the sidecar's closed
// union so a core definition or a future backend isn't forced to invent a
// wire error code that never existed.
// ============================================================

export interface AgentError {
  code: string;
  message: string;
  /** Capability-specific extra detail (e.g. generate_task_nodes's attempt
   * count) -- optional, and never required for a caller to render a
   * reasonable failure message from `message` alone. */
  details?: Record<string, unknown>;
}
