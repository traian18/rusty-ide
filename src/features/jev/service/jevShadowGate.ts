import type { AgentEvent, AgentEventEnvelope } from "@rusty/harness-sdk";
import { DECIDE_TOOL_NAME } from "../../../harness/core/decideToolConfig";
import type { FollowUpCall, ToolDecisionObserver, ToolDecisionSessionContext } from "../../../harness/core/toolDecisionObserver";
import type { ToolExecutionStepLevel } from "../../../harness/contract/observability";
import { postJevDecision, type JevDecisionResponse, type JevScoreAnswer } from "../../providers";
import { JEV_ACTION_LABELS, MAX_THOUGHT_CHARS, MAX_RESULT_PREVIEW_CHARS, HistoryStep, ProposedAction, clip, clipTail, stringify, describeHistory, buildActionState, actionDecisionBody, parseActionAnswer } from "./jevShadowPrompts";
import {type JevShadowStats} from "./jevShadowStats";

/** Where JEV is reached; `undefined` while the shadow gate is off or OpenRouter/JEV is unavailable. */
export interface JevShadowConfig {
  apiKey: string;
  jevModelId: string;
}

const MAX_IN_FLIGHT = 4;
/** Calls waiting for a free request slot; beyond this, new calls go unscored. */
export const MAX_QUEUED = 200;
/** Waits before retrying a transient failure (network error, HTTP 429 or 5xx). */
const RETRY_DELAYS_MS = [1_000, 3_000];

interface FollowUpWatch {
  /** Calls at or before this step index are not follow-ups. */
  afterIndex: number;
  watchedCallId: string;
  listener: (call: FollowUpCall) => boolean;
}

interface AgentTrack {
  sessionId?: string;
  parentAgentId?: string;
  model?: string;
  pendingThought: string;
  steps: HistoryStep[];
  byCallId: Map<string, HistoryStep>;
  followUps: FollowUpWatch[];
}

interface RunTrack {
  sessions: Map<string, ToolDecisionSessionContext>;
  agents: Map<string, AgentTrack>;
}

export interface JevShadowGateOptions {
  config: () => JevShadowConfig | undefined;
  stats: JevShadowStats;
  /** Adds a step to the tool call's own observability record. */
  record: (runId: string, sessionId: string, callId: string, level: ToolExecutionStepLevel, message: string, details?: unknown) => void;
  post?: typeof postJevDecision;
  /** Waits between retries; injectable for tests. */
  sleep?: (ms: number) => Promise<void>;
}

type ActionResponse = { answers?: { action?: JevScoreAnswer }; usage?: { cost?: number } };

/**
 * Shadow mode: JEV scores every tool call any model proposes, but the call
 * runs regardless. The verdict lands on the call's observability record and
 * in `stats`, next to how the call actually ended, so a model's decisions
 * can be compared with JEV's before JEV is ever allowed to block one.
 */
export class JevShadowGate implements ToolDecisionObserver {
  private runs = new Map<string, RunTrack>();
  private inFlight = 0;
  /** Scoring requests waiting for a free slot, oldest first. */
  private queue: Array<() => Promise<void>> = [];
  private readonly post: typeof postJevDecision;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(private options: JevShadowGateOptions) {
    this.post = options.post ?? postJevDecision;
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  beginSession(runId: string, sessionId: string, context: ToolDecisionSessionContext): void {
    this.track(runId).sessions.set(sessionId, context);
  }

  endRun(runId: string): void {
    this.runs.delete(runId);
  }

  observe(runId: string, envelope: AgentEventEnvelope): void {
    const run = this.runs.get(runId);
    const sessionId = envelope.session_id;
    if (!run || !sessionId) return;
    const event = envelope.event as AgentEvent;
    const agent = this.agent(run, envelope.agent_id);
    agent.sessionId ??= sessionId;
    agent.parentAgentId ??= envelope.parent_agent_id ?? undefined;

    if ("UsageUpdated" in event) {
      const model = (event.UsageUpdated.usage as { model?: unknown }).model;
      if (typeof model === "string" && model) agent.model = model;
      return;
    }
    if ("AssistantTextDelta" in event) {
      agent.pendingThought = clipTail(agent.pendingThought + event.AssistantTextDelta.delta, MAX_THOUGHT_CHARS * 2);
      return;
    }
    if ("ToolCallRequested" in event) {
      const call = event.ToolCallRequested.call;
      const step: HistoryStep = { callId: call.id, tool: call.name, arguments: stringify(call.arguments) };
      const thought = agent.pendingThought.trim();
      if (thought) step.thought = thought;
      agent.pendingThought = "";
      const history = [...agent.steps];
      agent.steps.push(step);
      agent.byCallId.set(call.id, step);
      // A `decide` call is JEV's own decision; scoring it would grade JEV against itself.
      if (step.tool === DECIDE_TOOL_NAME) return;
      const context = run.sessions.get(sessionId);
      this.score(runId, sessionId, call.id, context, agent.model ?? context?.model ?? "unknown", {
        prompt: context?.prompt ?? "",
        history,
        thought,
        tool: step.tool,
        arguments: step.arguments,
      });
      return;
    }
    if ("ToolCallCompleted" in event) {
      const { call_id: callId, result } = event.ToolCallCompleted;
      const step = agent.byCallId.get(callId);
      if (step) {
        step.outcome = { failed: result.has_error, preview: clip((result.output_preview ?? "").trim(), MAX_RESULT_PREVIEW_CHARS) };
        agent.byCallId.delete(callId);
        this.notifyFollowUps(agent, step);
      }
      this.options.stats.update(`${sessionId}:${callId}`, { toolOutcome: result.has_error ? "failed" : "succeeded" });
    }
  }

  private score(
    runId: string,
    sessionId: string,
    callId: string,
    context: ToolDecisionSessionContext | undefined,
    model: string,
    action: ProposedAction,
  ): void {
    const config = this.options.config();
    if (!config) return;
    const id = `${sessionId}:${callId}`;
    this.options.stats.update(id, {}, {
      at: new Date().toISOString(),
      runId,
      capability: context?.capability ?? "unknown",
      model,
      tool: action.tool,
    });
    const record = (level: ToolExecutionStepLevel, message: string, details?: unknown) => {
      try {
        this.options.record(runId, sessionId, callId, level, message, details);
      } catch (error) {
        console.warn("JEV shadow verdict could not be recorded:", error);
      }
    };
    if (this.inFlight >= MAX_IN_FLIGHT && this.queue.length >= MAX_QUEUED) {
      this.options.stats.update(id, { error: `Skipped: ${MAX_QUEUED} calls were already waiting for JEV.` });
      return;
    }

    const body = actionDecisionBody(config.jevModelId, buildActionState(action));
    this.queue.push(() => this.request(config, body, id, record));
    this.drain();
  }

  /** Starts queued requests while slots are free. */
  private drain(): void {
    while (this.inFlight < MAX_IN_FLIGHT && this.queue.length > 0) {
      const next = this.queue.shift()!;
      this.inFlight += 1;
      void next().finally(() => {
        this.inFlight -= 1;
        this.drain();
      });
    }
  }

  private async request(
    config: JevShadowConfig,
    body: ReturnType<typeof actionDecisionBody>,
    id: string,
    record: (level: ToolExecutionStepLevel, message: string, details?: unknown) => void,
  ): Promise<void> {
    for (let attempt = 0; ; attempt += 1) {
      const canRetry = attempt < RETRY_DELAYS_MS.length;
      let response: JevDecisionResponse<ActionResponse>;
      try {
        response = await this.post<ActionResponse>(config.apiKey, body);
      } catch (error: unknown) {
        if (canRetry) {
          await this.sleep(RETRY_DELAYS_MS[attempt]);
          continue;
        }
        const message = error instanceof Error ? error.message : String(error);
        this.options.stats.update(id, { error: `JEV could not be reached: ${message}` });
        record("warn", `JEV shadow: could not be reached: ${message}`);
        return;
      }
      if (!response.ok && (response.status === 429 || response.status >= 500) && canRetry) {
        await this.sleep(RETRY_DELAYS_MS[attempt]);
        continue;
      }
      const scored = response.ok ? parseActionAnswer(response.result) : undefined;
      if (!scored) {
        const error = response.ok ? "JEV returned an invalid answer." : `JEV request failed (HTTP ${response.status}).`;
        this.options.stats.update(id, { error });
        record("warn", `JEV shadow: ${error}`, { request: body, response: response.result ?? response.text });
        return;
      }
      this.options.stats.update(id, { verdict: scored.verdict, confidence: scored.confidence, cost: scored.cost });
      record(
        scored.verdict === "proceed" ? "info" : "warn",
        `JEV shadow (${config.jevModelId}): ${JEV_ACTION_LABELS[scored.verdict]} with confidence ${scored.confidence.toFixed(2)}. Not enforced.`,
        { probabilities: scored.probabilities, cost: scored.cost, request: body },
      );
      return;
    }
  }

  describeHistoryBefore(runId: string, sessionId: string, toolCallId: string): string | undefined {
    const found = this.locate(runId, sessionId, toolCallId);
    return found ? describeHistory(found.agent.steps.slice(0, found.index)) : undefined;
  }

  watchFollowUp(runId: string, sessionId: string, toolCallId: string, listener: (call: FollowUpCall) => boolean): void {
    const found = this.locate(runId, sessionId, toolCallId);
    found?.agent.followUps.push({ afterIndex: found.index, watchedCallId: toolCallId, listener });
  }

  /** The agent that made the call and the call's step index. If its
   * `ToolCallRequested` has not arrived yet, the call belongs after every
   * step so far of the session's top-level agent (only top-level agents
   * get host tools). */
  private locate(runId: string, sessionId: string, toolCallId: string): { agent: AgentTrack; index: number } | undefined {
    const run = this.runs.get(runId);
    if (!run) return undefined;
    for (const agent of run.agents.values()) {
      const index = agent.steps.findIndex((step) => step.callId === toolCallId);
      if (index >= 0) return { agent, index };
    }
    for (const agent of run.agents.values()) {
      if (agent.sessionId === sessionId && !agent.parentAgentId) return { agent, index: agent.steps.length };
    }
    return undefined;
  }

  private notifyFollowUps(agent: AgentTrack, step: HistoryStep): void {
    if (agent.followUps.length === 0 || !step.callId || !step.outcome) return;
    const index = agent.steps.indexOf(step);
    const call: FollowUpCall = { callId: step.callId, tool: step.tool, failed: step.outcome.failed };
    agent.followUps = agent.followUps.filter((watch) => {
      if (index <= watch.afterIndex || step.callId === watch.watchedCallId) return true;
      try {
        return watch.listener(call);
      } catch (error) {
        console.warn("JEV follow-up listener failed:", error);
        return false;
      }
    });
  }

  private track(runId: string): RunTrack {
    let run = this.runs.get(runId);
    if (!run) {
      run = { sessions: new Map(), agents: new Map() };
      this.runs.set(runId, run);
    }
    return run;
  }

  private agent(run: RunTrack, agentId: string): AgentTrack {
    let agent = run.agents.get(agentId);
    if (!agent) {
      agent = { pendingThought: "", steps: [], byCallId: new Map(), followUps: [] };
      run.agents.set(agentId, agent);
    }
    return agent;
  }
}
