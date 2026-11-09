// A run's context observations: what reaches its chat of its requests' estimates and compaction
// lifecycles, and how long its session stays open for them.
//
// A run that settles while a background summary it started is still being written keeps its
// session for that summary alone: its lifecycle events and its own model call still go through,
// anything else is refused, and the session closes once the last summary finished (or the chat
// let go of the run). Ordinary run work still ends at settlement.

import type { AgentEventEnvelope } from "@rusty/harness-sdk";
import type { ContextObservation } from "../../contract";
import { isContextSummaryRequest } from "../contextCompaction";
import type { BridgeEvent, CoreEngine, LifecycleRecovery } from "../engine/CoreEngineClient";
import { LifecycleTracker, toObservation } from "./contextObservations";
import { ignoreFailure, reportIgnored } from "./failures";
import type { HostExecuteCallData } from "./hostCalls";

/** What the visibility of a run needs from the run. */
export interface ContextVisibilityHost {
  engine(): CoreEngine;
  sessionId(): string | undefined;
  isSettled(): boolean;
  show(observation: ContextObservation): void;
  /** Answers a pending summary's model call after the run settled. */
  answerSummaryTurn(call: HostExecuteCallData): void;
  closeSession(id: string): void;
}

export class RunContextVisibility {
  /** The session's compaction lifecycle events, each shown once and in order. */
  private readonly lifecycle = new LifecycleTracker();
  /** Settled with summaries pending: the session stays open for them alone. */
  private lingering = false;
  /** Lives as long as the session: aborts a pending summary's model call when it closes. */
  private readonly sessionLife = new AbortController();
  private recovering = false;
  private recoverAgain = false;
  private sessionClosed = false;

  constructor(private readonly host: ContextVisibilityHost) {}

  /** The signal a context summary's model call runs with: it may outlive the run. */
  get summarySignal(): AbortSignal {
    return this.sessionLife.signal;
  }

  /** The run settled: closes its session, unless a summary it started is still pending. */
  settled(cancelled: boolean): void {
    if (!cancelled && this.lifecycle.pendingSummaries() > 0) {
      this.lingering = true;
      return;
    }
    this.release();
  }

  /** Closes the session and aborts any pending summary call. Idempotent. */
  release(): void {
    this.lingering = false;
    this.sessionLife.abort();
    const id = this.host.sessionId();
    if (this.sessionClosed || !id) return;
    this.sessionClosed = true;
    this.host.closeSession(id);
  }

  /** Handles a context observation; false when `envelope` is none. Only the root session's main
   * agent makes qualifying requests: a subagent's or a workflow step's (`step`) never do. After
   * settling, only a lingering session's lifecycle events still reach the chat. */
  observe(envelope: AgentEventEnvelope, step = false): boolean {
    const observation = toObservation(envelope, !step && !envelope.parent_agent_id);
    if (!observation) return false;
    if (this.host.isSettled() && (!this.lingering || observation.type !== "compaction")) return true;
    // A step's session is not this one: its retained events cannot be recovered from here.
    const { show, recover } = this.lifecycle.accept(observation, !step);
    show.forEach((shown) => this.host.show(shown));
    if (recover) this.recover();
    this.closeWhenDone();
    return true;
  }

  /** Lifecycle events recovered after a gap, or by a recovery this asked for. */
  recovered(recovery: LifecycleRecovery): void {
    if (this.host.isSettled() && !this.lingering) return;
    const observations = recovery.envelopes.flatMap((envelope) => toObservation(envelope, !envelope.parent_agent_id) ?? []);
    this.lifecycle.recovered(observations).forEach((shown) => this.host.show(shown));
    this.closeWhenDone();
  }

  /** A bridge event after the run settled: only what a pending summary needs gets through. */
  lateBridgeEvent(event: BridgeEvent): void {
    if (!this.lingering) return;
    if (event.kind === "event") this.observe(event.data);
    else if (event.kind === "lifecycle_recovery") this.recovered(event.data);
    else if (event.kind === "closed") this.release();
    else if (event.kind === "host_execute_call") this.lateModelCall(event.data);
  }

  private lateModelCall(call: HostExecuteCallData): void {
    if (isContextSummaryRequest(call.input)) return this.host.answerSummaryTurn(call);
    const sessionId = this.host.sessionId();
    if (!sessionId) return;
    void this.host.engine().hostExecuteResult(sessionId, call.call_id, {
      ok: false,
      error: { InvalidRequest: { message: "The run has finished; only a pending context summary may still run." } },
    }).catch(ignoreFailure(`refusing model turn ${call.call_id}`));
  }

  /** A lingering session closes once its last summary finished and no finish waits on recovery. */
  private closeWhenDone(): void {
    if (this.lingering && this.lifecycle.pendingSummaries() === 0 && !this.lifecycle.holding() && !this.recovering) this.release();
  }

  /** Asks the session for its retained lifecycle events, so a held finish shows with its start. */
  private recover(): void {
    if (this.recovering) {
      this.recoverAgain = true;
      return;
    }
    const sessionId = this.host.sessionId();
    const engine = this.host.engine();
    const unavailable: LifecycleRecovery = { status: "unavailable", envelopes: [] };
    if (!sessionId || !engine.recoverLifecycle) return this.recovered(unavailable);
    this.recovering = true;
    void engine.recoverLifecycle(sessionId, 0)
      .catch((error: unknown) => {
        reportIgnored("recovering compaction activity", error);
        return unavailable;
      })
      .then((recovery) => {
        this.recovering = false;
        this.recovered(recovery);
        if (this.recoverAgain && this.lifecycle.holding()) {
          this.recoverAgain = false;
          this.recover();
        }
      });
  }
}
