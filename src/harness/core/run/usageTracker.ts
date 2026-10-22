import type { AgentEventEnvelope } from "@rusty/harness-sdk";
import type { TokenUsage } from "../../contract";
import type { UsageRecordSample } from "../../contract/controlPlane";
import { NOOP_TOOL_EXECUTION_OBSERVER, type ToolExecutionObserver, type ToolExecutor } from "../../contract/observability";
import { executionObservability, parseUsageTokens } from "../../../observability/executionStore";
import { addUsage, hasTokens, mapAgentUsage, UsageAccumulator, usageRequestKey } from "../usageAccumulator";
import { ignoreFailure, observe } from "./failures";

export interface UsageContext {
  workspaceRoot: string;
  model: string;
  provider?: string;
}

function usageSample(
  context: UsageContext,
  surface: string,
  runId: string,
  usage: TokenUsage,
  newRequest = true,
): UsageRecordSample {
  return {
    newRequest,
    workspaceRoot: context.workspaceRoot,
    surface,
    runId,
    provider: context.provider,
    model: context.model,
    usage: {
      input: usage.input ?? 0,
      output: usage.output ?? 0,
      cacheRead: usage.cacheRead ?? 0,
      cacheWrite: usage.cacheWrite ?? 0,
      reasoning: usage.reasoning,
      totalTokens: usage.totalTokens ?? ((usage.input ?? 0) + (usage.output ?? 0)),
    },
  };
}

function toolUsageDelta(usage: unknown): TokenUsage {
  const tokens = parseUsageTokens(usage);
  return {
    totalTokens: tokens.totalTokens ?? ((tokens.inputTokens ?? 0) + (tokens.outputTokens ?? 0)),
    input: tokens.inputTokens,
    output: tokens.outputTokens,
    cacheRead: tokens.cacheReadTokens,
    cacheWrite: tokens.cacheWriteTokens,
    ...(tokens.reasoningTokens !== undefined ? { reasoning: tokens.reasoningTokens } : {}),
  };
}

/** Where a tracker's numbers go: Token Metrics, and live listeners keyed by run and model. */
export interface UsageSinks {
  recordUsage(sample: UsageRecordSample): Promise<void>;
  notify(key: string, total: TokenUsage): void;
}

/**
 * One run's usage accounting, shared by every session and tool call in it.
 * rusty-core reports usage as repeated per-request snapshots; the tracker
 * turns them into per-model running totals for displays (Tool Execution
 * Observability, `usage` events, live metrics listeners) and into
 * increments for Token Metrics, so no request is counted twice. Tokens a
 * tool spends on its own delegated model are recorded the same way,
 * under that model.
 */
export function createUsageTracker(runId: string, surface: string, context: UsageContext, sinks: UsageSinks) {
  const byModel = new Map<string, UsageAccumulator>();
  const record = (sample: UsageRecordSample) =>
    observe(() => void sinks.recordUsage(sample).catch(ignoreFailure(`recording ${sample.surface} usage`)));
  return {
    /** Every run and subagent model's tokens so far (tool models excluded). */
    runTotal: (): TokenUsage => [...byModel.values()].reduce<TokenUsage>((sum, accumulator) => addUsage(sum, accumulator.total()), {}),
    /** One `UsageUpdated` from `envelope`, in a session whose default model
     * is `sessionModel`. The snapshot names the model the agent actually
     * runs on (a subagent may use another); usage is attributed to it.
     * Returns that model's running total for the run. */
    session: (envelope: AgentEventEnvelope, snapshot: unknown, sessionModel: string = context.model): TokenUsage => {
      const stamped = (snapshot as { model?: unknown } | null)?.model;
      const model = typeof stamped === "string" && stamped ? stamped : sessionModel;
      const role = envelope.parent_agent_id ? "subagent" as const : "run" as const;
      const key = `${role}:${model}`;
      let accumulator = byModel.get(key);
      if (!accumulator) byModel.set(key, (accumulator = new UsageAccumulator()));
      const { delta, total, newRequest } = accumulator.apply(usageRequestKey(snapshot), mapAgentUsage(snapshot));
      observe(() => executionObservability.recordUsage(runId, total, { model, provider: context.provider, role, agentId: envelope.agent_id, delta }));
      sinks.notify(`${runId}:${key}`, total);
      if (hasTokens(delta)) record(usageSample({ ...context, model }, surface, runId, delta, newRequest));
      return total;
    },
    /** Tokens a run spends outside its agents' turns (a background context
     * summary): recorded in Token Metrics under its own surface, like tool
     * models, and kept out of the run's own total. */
    background: (model: string, delta: TokenUsage, label: string) => {
      if (!hasTokens(delta)) return;
      record(usageSample({ ...context, model }, `${surface}/${label}`, runId, delta));
    },
    /** The observer a host tool handler gets: reports to observability and
     * records any delegated usage into Token Metrics. */
    tool: (sessionId: string, toolCallId: string | undefined, toolName: string): ToolExecutionObserver => {
      let base = NOOP_TOOL_EXECUTION_OBSERVER;
      observe(() => {
        base = executionObservability.toolObserver(runId, sessionId, toolCallId);
      });
      let executor: ToolExecutor | undefined;
      let callTotal: TokenUsage = {};
      const callKey = `${runId}:tool:${toolCallId ?? crypto.randomUUID()}`;
      return {
        executedBy: (value) => {
          executor = value;
          base.executedBy(value);
        },
        step: (level, message, details) => base.step(level, message, details),
        usage: (usage) => {
          base.usage(usage);
          const delta = toolUsageDelta(usage);
          if (!hasTokens(delta)) return;
          callTotal = addUsage(callTotal, delta);
          sinks.notify(callKey, callTotal);
          const model = executor?.model ?? executor?.provider ?? "unknown";
          record(usageSample({ workspaceRoot: context.workspaceRoot, model, provider: executor?.provider }, `${surface}/${toolName}`, runId, delta));
        },
      };
    },
  };
}

export type UsageTracker = ReturnType<typeof createUsageTracker>;
