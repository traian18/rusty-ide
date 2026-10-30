import type { ToolExecutionObserver, ToolExecutionStepLevel } from "../../../harness/contract/observability";
import { NOOP_TOOL_EXECUTION_OBSERVER } from "../../../harness/contract/observability";
import { sanitizeForObservability } from "./redaction";
import { toolCallRecordId } from "./toolCallRecords";
import type { TrajectoryStore } from "./trajectoryStore";
import type { ToolExecutionDetail } from "./types";
import { addTokens, definedTokens, parseUsageTokens } from "./usageTokens";

const MAX_EXECUTION_STEPS = 100;

/** What the observer needs from the store: apply an update to one call's detail. */
export type ReportToolExecution = (runId: string, id: string, update: (detail: ToolExecutionDetail) => ToolExecutionDetail) => void;

/** The observer a tool reports through while it runs: who executed it, what it spent and its steps. */
export function createToolObserver(
  runId: string,
  sessionId: string,
  toolCallId: string | undefined,
  reportToolExecution: ReportToolExecution,
  trajectoryStore: TrajectoryStore,
): ToolExecutionObserver {
  if (!toolCallId) return NOOP_TOOL_EXECUTION_OBSERVER;
  const id = toolCallRecordId(sessionId, toolCallId);
  const report = (update: (detail: ToolExecutionDetail) => ToolExecutionDetail) => {
    try {
      reportToolExecution(runId, id, update);
    } catch (error) {
      console.warn("Tool execution observability failed without affecting the tool:", error);
    }
  };
  return {
    executedBy: (executor) => report((detail) => ({ ...detail, executor: { ...executor } })),
    usage: (usage) => report((detail) => {
      const delta = definedTokens(parseUsageTokens(usage));
      const executor = detail.executor;
      const model = executor?.model ?? executor?.provider ?? "unknown";
      trajectoryStore.addUsage(runId, `tool:${model}`, {
        model,
        provider: executor?.provider,
        role: "tool",
        purpose: executor?.purpose,
      }, delta);
      return { ...detail, tokens: addTokens(detail.tokens, delta) };
    }),
    step: (level: ToolExecutionStepLevel, message: string, details?: unknown) =>
      report((detail) => ({
        ...detail,
        steps: [
          ...detail.steps,
          { at: new Date().toISOString(), level, message, ...(details === undefined ? {} : { details: sanitizeForObservability(details).value }) },
        ].slice(-MAX_EXECUTION_STEPS),
      })),
  };
}
