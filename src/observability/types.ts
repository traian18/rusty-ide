import type { CapabilityName } from "../harness/contract";
import type { ExecutionOrigin, ToolExecutionStepLevel, ToolExecutor } from "../harness/contract/observability";

export type { ExecutionOrigin, ToolExecutor } from "../harness/contract/observability";

export type ToolExecutionStatus =
  | "queued"
  | "waiting-permission"
  | "running"
  | "succeeded"
  | "failed"
  | "cancelled";

export interface ExecutionTokensSnapshot {
  totalTokens?: number;
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  reasoningTokens?: number;
}

/** Tokens one model spent within a run: the model the run itself called
 * (`run`), a subagent's model (`subagent`), or a model a tool delegated to
 * (`tool`, e.g. a Smart Read selector). */
export interface ModelUsageEntry {
  model: string;
  provider?: string;
  role: "run" | "subagent" | "tool";
  purpose?: string;
  tokens: ExecutionTokensSnapshot;
}

/** Keyed by `${role}:${model}`, since one model can serve both roles. */
export type RunUsage = Record<string, ModelUsageEntry>;

export interface ExecutionSelectionContext {
  filePath: string;
  lineRange?: string;
  textPreview?: string;
}

export interface ExecutionContextSnapshot {
  capability: CapabilityName;
  workspaceRoot?: string;
  model?: string;
  provider?: string;
  requestPrompt?: string;
  selection?: ExecutionSelectionContext;
  inputKeys: string[];
  fileReferences: string[];
  skill?: string;
  mcpServers: string[];
}

export interface RequestingModel {
  model?: string;
  provider?: string;
  subagent?: boolean;
}

export interface ToolExecutionStep {
  at: string;
  level: ToolExecutionStepLevel;
  message: string;
  details?: unknown;
}

/** What a tool itself reported about executing one call, via its
 * `ToolExecutionObserver`. */
export interface ToolExecutionDetail {
  executor?: ToolExecutor;
  /** Tokens spent by the executor -- separate from the requesting run's own. */
  tokens?: ExecutionTokensSnapshot;
  steps: ToolExecutionStep[];
}

export interface ToolExecutionRecord {
  id: string;
  callId: string;
  ideRunId: string;
  sessionId?: string;
  coreRunId?: string;
  agentId?: string;
  parentAgentId?: string;
  toolName: string;
  status: ToolExecutionStatus;
  requestedAt: string;
  startedAt?: string;
  finishedAt?: string;
  durationMs?: number;
  tokens?: ExecutionTokensSnapshot;
  arguments?: unknown;
  resultPreview?: string;
  progress?: { status: string; fraction: number };
  permission?: { requestId: string; state: "waiting" | "resolved-by-run" };
  origin: ExecutionOrigin;
  context: ExecutionContextSnapshot;
  execution?: ToolExecutionDetail;
  /** The model that issued this call (the run's model, or a subagent's). */
  requestedBy?: RequestingModel;
  agentSequence?: number;
  sessionSequence?: number;
  payloadState: "full" | "truncated" | "redacted";
}

export interface ObservabilitySnapshot {
  records: ToolExecutionRecord[];
  retentionDays: 7 | 30 | 90 | null;
  storageBytes: number;
  lastError?: string;
}
