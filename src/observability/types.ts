import type { CapabilityName } from "../harness/contract";
import type { ExecutionOrigin } from "../harness/contract/observability";

export type { ExecutionOrigin } from "../harness/contract/observability";

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
