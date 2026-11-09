// Answering a session's model turn (`host_execute_call`) on the run's provider.

import type { CapabilityEvent, CapabilityInput, CapabilityName } from "../../contract";
import { trajectories } from "../../../features/observability";
import type { CoreCapabilityDefinition, ExecutionAnswerer, RunContext } from "../CoreHarness";
import { isContextSummaryRequest } from "../contextCompaction";
import type { CoreEngine } from "../engine/CoreEngineClient";
import type { ExecutionEvent, ExecutionRequest, ExecutionResult } from "../engine/ExecutionProtocol";
import { observe, reportIgnored } from "./failures";
import { answerExecuteCall, type HostExecuteCallData } from "./hostCalls";
import type { UsageTracker } from "./usageTracker";

/** What a model turn runs with. */
export interface ModelTurnRun<K extends CapabilityName> {
  runId: string;
  engine: CoreEngine;
  definition: CoreCapabilityDefinition<K>;
  input: CapabilityInput<K>;
  context: RunContext;
  onEvent: (event: CapabilityEvent<K>) => void;
  usage: UsageTracker;
  executionAnswerer: ExecutionAnswerer;
  /** Ends the run's own turns. */
  signal: AbortSignal;
  /** Ends a context summary's turn: it may outlive the run, and ends with the session. */
  summarySignal: AbortSignal;
}

/** rusty-core's background context summary is answered on the run's provider like any turn, but
 * never treated as a step's first turn, and its tokens are accounted as their own surface. */
export function answerModelTurn<K extends CapabilityName>(run: ModelTurnRun<K>, sessionId: string, data: HostExecuteCallData): void {
  const contextSummary = isContextSummaryRequest(data.input);
  const recordSummaryUsage = (result: ExecutionResult) =>
    run.usage.background(data.input.params?.model ?? run.definition.usageContext(run.input).model, result.usage, "context_summary");
  answerExecuteCall(run.engine, sessionId, data.call_id, (onEvent) => runModelTurn(run, data.input, contextSummary, onEvent), contextSummary ? recordSummaryUsage : undefined);
}

/** The capability may adjust the request first (a per-step model), and the turn waits for it; a
 * failure there never costs the model turn. Without that hook the answerer starts synchronously,
 * as it always has. */
function runModelTurn<K extends CapabilityName>(run: ModelTurnRun<K>, request: ExecutionRequest, contextSummary: boolean, onEvent: (event: ExecutionEvent) => void): Promise<ExecutionResult> {
  const run_ = (prepared: ExecutionRequest) => execute(run, prepared, contextSummary, onEvent);
  if (!run.definition.prepareExecution || contextSummary) return run_(request);
  return Promise.resolve()
    .then(() => run.definition.prepareExecution!(request, run.input, run.context, run.onEvent, run.signal))
    .catch((error: unknown) => {
      reportIgnored("preparing the model request", error);
      return request;
    })
    .then(run_);
}

function execute<K extends CapabilityName>(run: ModelTurnRun<K>, request: ExecutionRequest, contextSummary: boolean, onEvent: (event: ExecutionEvent) => void): Promise<ExecutionResult> {
  observe(() => trajectories.append(run.runId, contextSummary ? "Context summary request" : "Model request", request));
  try {
    return run.executionAnswerer.execute(request, run.input.customProvider, onEvent, contextSummary ? run.summarySignal : run.signal);
  } catch (error: unknown) {
    return Promise.reject(error);
  }
}
