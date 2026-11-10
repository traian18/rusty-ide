// What core reports about a request's context, as the chat sees it: request starts and estimates,
// and each compaction operation's start and finish. Nothing here is inferred: an environment that
// reports none of it shows none of it.
//
// A finish can arrive before its start (a lagging subscription lost the start). The tracker holds
// such a finish while the session's retained lifecycle events can still be recovered, shows the
// recovered start before it, and shows the finish alone, marked, once recovery proves the start
// absent or is unavailable. It never invents a start.

import type { AgentEvent, AgentEventEnvelope } from "@rusty/harness-sdk";
import type { ContextEstimate, ContextObservation, ContextObservationIdentity } from "../../contract";

type Payload<K extends string> = K extends keyof Extract<AgentEvent, Record<K, unknown>>
  ? Extract<AgentEvent, Record<K, unknown>>[K]
  : never;

function identity(envelope: AgentEventEnvelope, request: { request_id: string; request_start_order: number }): ContextObservationIdentity {
  return {
    eventId: envelope.event_id,
    sessionId: envelope.session_id,
    agentId: envelope.agent_id,
    runId: envelope.run_id ?? null,
    requestId: request.request_id,
    requestStartOrder: request.request_start_order,
    agentSequence: envelope.agent_sequence,
  };
}

function estimateOf(payload: Payload<"ContextUpdated">): ContextEstimate | null {
  if (!("available" in payload.availability)) return null;
  const available = payload.availability.available;
  return {
    model: payload.model,
    estimatedInputTokens: available.estimated_input_tokens,
    inputBudget: available.input_budget,
    modelWindow: available.model_window,
    remainingInputTokens: available.remaining_input_tokens,
    usagePercent: available.usage_percent,
  };
}

/** The observation an envelope carries, if it carries one. `qualifying`: the envelope is the
 * chat's own main-agent request. */
export function toObservation(envelope: AgentEventEnvelope, qualifying: boolean): ContextObservation | undefined {
  const event = envelope.event as Record<string, unknown>;
  if ("ContextRequestStarted" in event) {
    const payload = event.ContextRequestStarted as Payload<"ContextRequestStarted">;
    return { type: "request_started", identity: identity(envelope, payload), qualifying };
  }
  if ("ContextUpdated" in event) {
    const payload = event.ContextUpdated as Payload<"ContextUpdated">;
    return { type: "estimate", identity: identity(envelope, payload), qualifying, estimate: estimateOf(payload) };
  }
  if ("CompactionStarted" in event) {
    const payload = event.CompactionStarted as Payload<"CompactionStarted">;
    return { type: "compaction", identity: identity(envelope, payload), operationId: payload.operation_id, compactionType: payload.compaction_type, phase: "started" };
  }
  if ("CompactionFinished" in event) {
    const payload = event.CompactionFinished as Payload<"CompactionFinished">;
    return {
      type: "compaction",
      identity: identity(envelope, payload),
      operationId: payload.operation_id,
      compactionType: payload.compaction_type,
      phase: "finished",
      outcome: payload.outcome,
    };
  }
  return undefined;
}

export function isLifecycleEnvelope(envelope: AgentEventEnvelope): boolean {
  const event = envelope.event as Record<string, unknown>;
  return "CompactionStarted" in event || "CompactionFinished" in event;
}

type Compaction = Extract<ContextObservation, { type: "compaction" }>;

/** One session's lifecycle events: each shown once, starts before their finishes. */
export class LifecycleTracker {
  private readonly seen = new Set<string>();
  private readonly started = new Set<string>();
  private readonly finished = new Set<string>();
  private readonly held = new Map<string, Compaction>();
  private readonly summaries = new Set<string>();
  /** Core runs whose events reached this tracker live. A chat's kept session also retains the
   * events of its earlier messages, which a recovery must not show again. */
  private readonly runs = new Set<string>();

  /** What to show for `observation` now, and whether a held finish needs a recovery.
   * `recoverable`: its session's retained events can be asked for. */
  accept(observation: ContextObservation, recoverable = true): { show: ContextObservation[]; recover: boolean } {
    if (observation.type !== "compaction") return { show: [observation], recover: false };
    if (this.seen.has(observation.identity.eventId)) return { show: [], recover: false };
    this.seen.add(observation.identity.eventId);
    if (recoverable) this.runs.add(observation.identity.runId ?? "");
    const id = observation.operationId;
    if (observation.phase === "started") {
      if (this.started.has(id)) return { show: [], recover: false };
      this.started.add(id);
      if (observation.compactionType === "background_summary" && !this.finished.has(id)) this.summaries.add(id);
      const finish = this.held.get(id);
      this.held.delete(id);
      return { show: finish ? [observation, this.finish(finish)] : [observation], recover: false };
    }
    if (this.finished.has(id)) return { show: [], recover: false };
    if (!this.started.has(id) && recoverable) {
      this.held.set(id, observation);
      return { show: [], recover: true };
    }
    return { show: [this.finish(observation, !this.started.has(id))], recover: false };
  }

  /** A recovery ended: recovered starts come out before their held finishes; a finish whose start
   * was not among them (or nothing could be recovered) is shown once, marked as such. */
  recovered(observations: ContextObservation[]): ContextObservation[] {
    const ours = (observation: ContextObservation) =>
      observation.type === "compaction" && (this.held.has(observation.operationId) || this.runs.has(observation.identity.runId ?? ""));
    const show = observations.filter(ours).flatMap((observation) => this.accept(observation, false).show);
    for (const finish of [...this.held.values()]) show.push(this.finish(finish, true));
    this.held.clear();
    return show;
  }

  /** Whether a finish is held while its start may still be recovered. */
  holding(): boolean {
    return this.held.size > 0;
  }

  /** Background summaries that started and have not finished. */
  pendingSummaries(): number {
    return this.summaries.size;
  }

  private finish(observation: Compaction, startMissing = false): Compaction {
    this.finished.add(observation.operationId);
    this.summaries.delete(observation.operationId);
    return startMissing ? { ...observation, startMissing: true } : observation;
  }
}
