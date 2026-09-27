/** IDE-owned provenance attached to a harness run. Backends may use it for
 * observability, but it never changes execution semantics. */
export type ExecutionSurface =
  | "agent-tab"
  | "canvas-node"
  | "inline-chat"
  | "reconciliation"
  | "skill-generation"
  | "test-build"
  | "other";

export interface ExecutionOrigin {
  surface: ExecutionSurface;
  workspaceId?: string;
  tabId?: string;
  canvasId?: string;
  nodeId?: string;
  displayLabel: string;
}

/** Who actually performed a tool call's work, when that is not the model
 * that requested it -- e.g. Smart Read's selector model, or an external
 * search service. Absent for tools the IDE host executes deterministically. */
export interface ToolExecutor {
  kind: "model" | "service";
  /** Short human label for the delegated work, e.g. "Smart Read selector". */
  purpose: string;
  model?: string;
  provider?: string;
  providerId?: string;
}

export type ToolExecutionStepLevel = "info" | "warn" | "error";

/** Handed to every host tool handler for the one call it is serving, so the
 * tool can report what happened inside it to the observability store. It is
 * fail-open and invisible to the requesting model: nothing reported here
 * reaches the tool's output or the run's transcript. */
export interface ToolExecutionObserver {
  /** Declares the model or service executing this call. */
  executedBy(executor: ToolExecutor): void;
  /** One increment of the delegated execution's token usage (e.g. the new
   * tokens of one model request); increments are summed per call and per
   * model, and recorded into Token Metrics. Raw provider/engine usage
   * shapes are accepted. */
  usage(usage: unknown): void;
  /** One notable internal step, shown in the call's execution trace. */
  step(level: ToolExecutionStepLevel, message: string, details?: unknown): void;
}

export const NOOP_TOOL_EXECUTION_OBSERVER: ToolExecutionObserver = {
  executedBy: () => {},
  usage: () => {},
  step: () => {},
};
