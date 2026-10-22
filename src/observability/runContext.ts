import type { AgentEventEnvelope } from "@rusty/harness-sdk";
import type { CapabilityName } from "../harness/contract";
import type { ExecutionOrigin, ExecutionTokensSnapshot, ToolExecutionRecord } from "./types";
import { addTokens } from "./usageTokens";

/** What the execution store tracks about one live harness run: its own
 * tokens per model, and which model each session, agent and spawned
 * subagent runs on, so calls and usage are attributed to it. */
export interface RunContext {
  capability: CapabilityName;
  origin: ExecutionOrigin;
  context: ToolExecutionRecord["context"];
  sessionId?: string;
  /** The run's own model(s), summed: what a record captures when requested. */
  tokens?: ExecutionTokensSnapshot;
  tokensByModel: Map<string, ExecutionTokensSnapshot>;
  /** Which model each session and agent runs on, for `requestedBy`. */
  sessionModels: Map<string, string>;
  agentModels: Map<string, string>;
  /** agent_spawn call record id -> the `model` it asked for, if any. */
  spawnModels: Map<string, string | undefined>;
  /** Child agent id -> the agent_spawn call record that created it. */
  childSpawnCalls: Map<string, string>;
}

const AGENT_SPAWN_TOOL = "agent_spawn";

export function createRunContext(capability: CapabilityName, origin: ExecutionOrigin, context: RunContext["context"]): RunContext {
  return {
    capability,
    origin,
    context,
    tokensByModel: new Map(),
    sessionModels: new Map(),
    agentModels: new Map(),
    spawnModels: new Map(),
    childSpawnCalls: new Map(),
  };
}

/** The run's tokens so far, copied so a record keeps its own snapshot. */
export function runTokensSnapshot(run: RunContext | undefined): ExecutionTokensSnapshot | undefined {
  return run?.tokens ? { ...run.tokens } : undefined;
}

/** Stores one model's running total and re-sums the run's tokens. */
export function setModelTokens(run: RunContext, key: string, tokens: ExecutionTokensSnapshot): void {
  run.tokensByModel.set(key, tokens);
  run.tokens = [...run.tokensByModel.values()].reduce<ExecutionTokensSnapshot>((sum, entry) => addTokens(sum, entry), {});
}

export function requestingModel(run: RunContext, envelope: AgentEventEnvelope): ToolExecutionRecord["requestedBy"] {
  const subagent = Boolean(envelope.parent_agent_id);
  const model = run.agentModels.get(envelope.agent_id)
    ?? (envelope.session_id ? run.sessionModels.get(envelope.session_id) : undefined)
    ?? run.context.model;
  return { model, provider: run.context.provider, ...(subagent ? { subagent } : {}) };
}

/** A raw UsageUpdated names the model its agent runs on. */
export function noteAgentModel(run: RunContext, agentId: string, usage: unknown): void {
  const model = (usage as { model?: unknown }).model;
  if (typeof model === "string" && model) run.agentModels.set(agentId, model);
}

/** Remembers the `model` an agent_spawn call asked for, if any. */
export function noteSpawnRequest(run: RunContext, recordId: string, call: { name: string; arguments: unknown }): void {
  if (call.name !== AGENT_SPAWN_TOOL) return;
  const requested = (call.arguments as { model?: unknown } | null)?.model;
  run.spawnModels.set(recordId, typeof requested === "string" && requested ? requested : undefined);
}

/** Links a child agent, spawned by the envelope's agent, to the agent_spawn
 * call that created it and returns its model: the one that call asked for,
 * else its parent's. The child keeps a model it already reported. */
export function adoptChildAgent(run: RunContext, envelope: AgentEventEnvelope, childAgentId: string, spawnId: string): string | undefined {
  const model = run.spawnModels.get(spawnId)
    ?? run.agentModels.get(envelope.agent_id)
    ?? (envelope.session_id ? run.sessionModels.get(envelope.session_id) : undefined)
    ?? run.context.model;
  run.childSpawnCalls.set(childAgentId, spawnId);
  if (model && !run.agentModels.has(childAgentId)) run.agentModels.set(childAgentId, model);
  return model;
}
