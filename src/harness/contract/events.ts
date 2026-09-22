// ============================================================
// events.ts — The stream vocabulary a running capability emits.
//
// CommonEvent covers what all nine capabilities share today (log/token/
// usage/subagent/command output); a capability with extra event shapes
// (execute_node's node_status_change, reconciliate_graph's per-file
// complete/error, test_build's iteration) unions CommonEvent with its own
// in capabilities.ts's CapabilityMap rather than growing this file per
// capability.
// ============================================================

export interface TokenUsage {
  totalTokens?: number;
  input?: number;
  output?: number;
  cacheRead?: number;
  cacheWrite?: number;
}

export type CommonEvent =
  | { kind: "log"; message: string }
  | { kind: "token"; content: string; messageId?: string }
  | { kind: "progress"; content: string }
  | { kind: "usage"; usage: TokenUsage }
  | { kind: "subagent"; subagent: unknown }
  | { kind: "files_changed"; paths: string[] }
  | { kind: "command_output"; content: string }
  | { kind: "command_complete" };

export interface NodeStatusChangeEvent {
  kind: "node_status_change";
  targetNodeId: string;
  status: string;
  message?: string;
  nodeName?: string;
}

export interface FileCompleteEvent {
  kind: "file_complete";
  filePath: string;
  taskIds: string[];
  modified: boolean;
  response: string;
}

export interface FileErrorEvent {
  kind: "file_error";
  filePath: string;
  taskIds: string[];
  error: string;
}

export interface IterationEvent {
  kind: "iteration";
  attempt: number;
  maxAttempts: number;
}
