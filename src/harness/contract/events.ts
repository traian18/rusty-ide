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
  reasoning?: number;
}

/** Who an observation of a request's context belongs to, from its core envelope. */
export interface ContextObservationIdentity {
  /** The observation, not one delivery of it: a replay or recovery repeats it. */
  eventId: string;
  sessionId: string;
  agentId: string;
  /** The run whose request it observes, even when it arrives after that run settled. */
  runId: string | null;
  requestId: string;
  /** Dispatch order of the request within its agent. */
  requestStartOrder: number;
  /** Order of the observation among its agent's events. */
  agentSequence: number;
}

/** An available estimate of the remaining input budget of a request as it went to the model. */
export interface ContextEstimate {
  model: string | null;
  estimatedInputTokens: number;
  inputBudget: number;
  modelWindow: number;
  remainingInputTokens: number;
  usagePercent: number;
}

export type CompactionKind = "standard" | "background_summary";
export type CompactionResult = "success" | "failure" | "cancelled";

/** What core reported about a request's context. `qualifying`: the chat's own main-agent request
 * (not a subagent's, a workflow step's or a context summary's), the only kind whose estimate the
 * chat shows. */
export type ContextObservation =
  | { type: "request_started"; identity: ContextObservationIdentity; qualifying: boolean }
  /** `estimate` is null when no trustworthy budget is known for the request. */
  | { type: "estimate"; identity: ContextObservationIdentity; qualifying: boolean; estimate: ContextEstimate | null }
  | {
      type: "compaction";
      identity: ContextObservationIdentity;
      operationId: string;
      compactionType: CompactionKind;
      phase: "started" | "finished";
      outcome?: CompactionResult;
      /** A finish whose start was never received and could not be recovered. */
      startMissing?: boolean;
    };

export type CommonEvent =
  | { kind: "workflow_checkpoint"; state: unknown }
  /** Core's estimate of a request's input budget, or a compaction operation's start or finish.
   * Transient: never saved with the chat. */
  | { kind: "context_observation"; observation: ContextObservation }
  | { kind: "log"; message: string }
  | { kind: "token"; content: string; messageId?: string }
  | { kind: "progress"; content: string }
  /** The model's task list after an `update_todos` call: the whole list, in order. In a workflow,
   * `step` says whose list it is: `key` is one step session (a retry or a queued task has its own). */
  | { kind: "plan"; todos: { content: string; status: "pending" | "in_progress" | "completed" | "cancelled" }[]; step?: { key: string; name: string } }
  | { kind: "usage"; usage: TokenUsage }
  | { kind: "subagent"; subagent: unknown }
  | { kind: "files_changed"; paths: string[] }
  | { kind: "command_output"; content: string }
  | { kind: "command_complete" }
  /** A workflow that may hand over to another, at the end of one of its steps. */
  | {
      kind: "workflow_boundary";
      /** "checking" while the router decides; then how it ended. */
      status: "checking" | "continue" | "switch";
      workflow: string;
      /** The step that just finished. */
      step: string;
    }
  /** A workflow step sent a question to a research step (`request_research`), which runs inside it. */
  | {
      kind: "workflow_research";
      workflowId: string;
      /** The step that asked. */
      nodeId: string;
      /** The tool call: one research run. */
      callId: string;
      question: string;
      status: "running" | "done" | "failed";
    }
  /** Progress of one step of a workflow run (`.rusty/workflows`). */
  | {
      kind: "workflow_step";
      workflowId: string;
      nodeId: string;
      /** The step's display name. */
      name?: string;
      status: "running" | "waiting" | "retry" | "succeeded" | "failed";
      attempt: number;
      message?: string;
    };

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
