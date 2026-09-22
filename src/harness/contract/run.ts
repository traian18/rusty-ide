// ============================================================
// run.ts — The shape of a single capability run, backend-agnostic.
// ============================================================

import type { AgentError } from "./errors";
import type { CapabilityName, CapabilityResult } from "./capabilities";

export type RunOutcome<K extends CapabilityName> =
  | { status: "completed"; result: CapabilityResult<K> }
  | { status: "failed"; error: AgentError }
  | { status: "cancelled" };

export interface RunHandle<K extends CapabilityName> {
  readonly runId: string;
  /** Resolves once the run has been accepted by the backend (the sidecar
   * connected and sent the start command; core created the session). A
   * connection failure rejects `started`, distinguishing "never started"
   * from "started and then failed" -- see agentRunCoordinator.ts's
   * onConnected/settled handling, which this replaces. */
  readonly started: Promise<void>;
  /** Resolves exactly once, with the run's terminal outcome. Never rejects --
   * a connection or backend failure is reported as `{status:"failed"}`. */
  readonly done: Promise<RunOutcome<K>>;
  /** Idempotent. Aborts every pending RunHost call for this run and, once the
   * backend acknowledges, settles `done` with `{status:"cancelled"}` (unless
   * it had already settled). */
  cancel(): void;
}
