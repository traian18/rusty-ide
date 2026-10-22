import type { AgentEventEnvelope } from "@rusty/harness-sdk";
import type { CapabilityName, RunHost } from "../../contract";
import { NOOP_TOOL_EXECUTION_OBSERVER, type ToolExecutionObserver } from "../../contract/observability";
import { executionObservability } from "../../../observability/executionStore";
import { trajectories } from "../../../observability/trajectoryStore";
import type { ExecutionAnswerer, HostToolHandler } from "../CoreHarness";
import type { BridgeEvent, CoreEngine } from "../engine/CoreEngineClient";
import type { SessionRecipe } from "../SessionRecipe";
import { toolDecisionObserver } from "../toolDecisionObserver";
import { createTranscript, type Transcript } from "../transcript";
import { dispatchAgentEvent, dispatchBridgeEvent, type AgentEventHandlers, type BridgeEventHandlers } from "./agentEvents";
import { errorMessage, ignoreFailure, observe } from "./failures";
import {
  answerExecuteCall,
  answerWorkspaceTool,
  deliverToolOutcome,
  failUnhandledTool,
  permissionDecision,
  permissionPrompt,
  type HostExecuteCallData,
  type HostToolCallData,
  type ToolPermissionRequest,
} from "./hostCalls";

export interface SingleShotSessionOptions {
  recipe: SessionRecipe;
  promptText: string;
  hostTools: Record<string, HostToolHandler>;
  host: RunHost;
  customProvider: unknown;
  onToken?: (content: string) => void;
  onLog?: (message: string) => void;
  /** Each raw `UsageUpdated` snapshot; accounting is the caller's. */
  onUsage?: (envelope: AgentEventEnvelope, snapshot: unknown) => void;
  toolObserver?: (sessionId: string, toolCallId: string | undefined, toolName: string) => ToolExecutionObserver;
  signal: AbortSignal;
  ideRunId: string;
  capability: CapabilityName;
}

const aborted = () => new DOMException("Aborted", "AbortError");

/**
 * Runs exactly one rusty-core session to completion: creates it, sends
 * one prompt, dispatches `host_tool_call`/`host_execute_call`/
 * `PermissionRequested` the same way `run()`'s own single-session path
 * does, and resolves with the accumulated `Transcript` once the session
 * reaches `Completed{outcome: "Success"}`. Rejects on `Failed`, on any
 * other `Completed` outcome, or when `signal` aborts (with a
 * `DOMException("Aborted", "AbortError")`, so a caller can `error.name
 * === "AbortError"` to tell a real cancellation apart from a genuine
 * failure). Always closes the session before settling, on every path.
 *
 * The one deliberate omission from `run()`'s own version: no
 * `onCompleted` retry loop and no `RunContext` -- both exist to serve
 * `hostTools()`'s per-run caching and cross-call state, which an
 * orchestrate capability's own tool set (built fresh per `runSession`
 * call, scoped to that one session) has no use for. Kept as a separate
 * path rather than unifying the two rather than risk destabilizing the
 * already-proven single-session path for a need nothing has yet.
 */
export function runSingleShotSession(engine: CoreEngine, answerer: ExecutionAnswerer, options: SingleShotSessionOptions): Promise<Transcript> {
  return new Promise<Transcript>((resolve, reject) => {
    new SingleShotSession(engine, answerer, options, resolve, reject).start();
  });
}

class SingleShotSession {
  private readonly engine: CoreEngine;
  private readonly answerer: ExecutionAnswerer;
  private readonly options: SingleShotSessionOptions;
  private readonly resolve: (transcript: Transcript) => void;
  private readonly reject: (error: unknown) => void;
  private readonly transcript = createTranscript();
  private sessionId: string | undefined;
  private settled = false;
  private readonly abortListener = () => this.finish(() => this.reject(aborted()));

  constructor(
    engine: CoreEngine,
    answerer: ExecutionAnswerer,
    options: SingleShotSessionOptions,
    resolve: (transcript: Transcript) => void,
    reject: (error: unknown) => void,
  ) {
    this.engine = engine;
    this.answerer = answerer;
    this.options = options;
    this.resolve = resolve;
    this.reject = reject;
  }

  start(): void {
    if (this.options.signal.aborted) {
      this.abortListener();
      return;
    }
    this.options.signal.addEventListener("abort", this.abortListener);
    void this.open();
  }

  private finish(settle: () => void): void {
    if (this.settled) return;
    this.settled = true;
    this.options.signal.removeEventListener("abort", this.abortListener);
    settle();
    if (this.sessionId) this.closeSession(this.sessionId);
  }

  private closeSession(id: string): void {
    void this.engine.closeSession(id).catch(ignoreFailure(`closing session ${id}`));
  }

  private async open(): Promise<void> {
    const { recipe, promptText, ideRunId, capability } = this.options;
    try {
      observe(() => trajectories.append(ideRunId, "Session context", {
        systemPrompt: recipe.system_prompt, prompt: promptText, integration: recipe.integration,
        executionParams: recipe.execution_params, tools: recipe.host_tools, workspace: recipe.workspace,
        contextVisibility: "Managed CLI internal context is not exposed; host model requests are recorded separately.",
      }));
      const id = await this.engine.createSession(recipe);
      if (this.settled) {
        this.closeSession(id);
        return;
      }
      this.sessionId = id;
      observe(() => executionObservability.bindSession(ideRunId, id, recipe.execution_params?.model));
      observe(() => toolDecisionObserver()?.beginSession(ideRunId, id, {
        capability, prompt: promptText, model: recipe.execution_params?.model ?? undefined,
      }));
      await this.engine.subscribe(id, (event) => this.onBridgeEvent(event));
      await this.engine.mutate(id, { type: "prompt", payload: { text: promptText, attachments: [] } });
    } catch (error: unknown) {
      this.finish(() => this.reject(error instanceof Error ? error : new Error(errorMessage(error))));
    }
  }

  private readonly bridgeHandlers: Partial<BridgeEventHandlers> = {
    event: (envelope) => this.onAgentEvent(envelope),
    gap: (gap) => this.options.onLog?.(`Dropped ${gap.dropped} event(s) after a slow consumer.`),
    host_tool_call: (call) => this.answerHostTool(call),
    host_execute_call: (call) => this.answerModelTurn(call),
    closed: (closed) => this.finish(() => this.reject(new Error(closed.reason))),
  };

  private onBridgeEvent(event: BridgeEvent): void {
    if (this.settled) return;
    dispatchBridgeEvent(this.bridgeHandlers, event);
  }

  private readonly agentHandlers: AgentEventHandlers = {
    AssistantTextDelta: ({ message_id, delta }) => {
      this.transcript.push(message_id, delta);
      this.options.onToken?.(delta);
    },
    UsageUpdated: ({ usage }, envelope) => this.options.onUsage?.(envelope, usage),
    ToolCallRequested: ({ call }) => this.options.onLog?.(`Calling ${call.name}...`),
    ToolCallStarted: ({ call_id }) => this.options.onLog?.(`Running tool call ${call_id}...`),
    ToolCallCompleted: ({ result }) => this.options.onLog?.(result.has_error ? "Tool call failed." : "Tool call completed."),
    PermissionRequested: ({ request }) => this.requestPermission(request),
    Failed: ({ error }) => this.finish(() => this.reject(new Error(error.message))),
    Completed: ({ outcome }) => this.onCompleted(outcome),
  };

  private onAgentEvent(envelope: AgentEventEnvelope): void {
    observe(() => executionObservability.ingest(this.options.ideRunId, envelope));
    observe(() => toolDecisionObserver()?.observe(this.options.ideRunId, envelope));
    dispatchAgentEvent(this.agentHandlers, envelope);
  }

  private onCompleted(outcome: string): void {
    if (outcome === "Success") return this.finish(() => this.resolve(this.transcript));
    if (outcome === "Cancelled") return this.finish(() => this.reject(aborted()));
    this.finish(() => this.reject(new Error("The run failed.")));
  }

  private answerHostTool(data: HostToolCallData): void {
    const sid = this.sessionId;
    if (!sid) return;
    const { host, signal, hostTools, toolObserver, ideRunId } = this.options;
    if (answerWorkspaceTool(this.engine, host, sid, data, signal)) return;
    const handler = hostTools[data.tool];
    if (!handler) return failUnhandledTool(this.engine, sid, data);
    const outcome = handler(data.input, signal, toolObserver?.(sid, data.tool_call_id, data.tool) ?? NOOP_TOOL_EXECUTION_OBSERVER, {
      runId: ideRunId,
      sessionId: sid,
      toolCallId: data.tool_call_id,
      configureExecution: (params) => this.engine.mutate(sid, { type: "configure_execution", payload: { params } }),
    });
    deliverToolOutcome(this.engine, sid, data.call_id, outcome);
  }

  private answerModelTurn(data: HostExecuteCallData): void {
    const sid = this.sessionId;
    if (!sid) return;
    observe(() => trajectories.append(this.options.ideRunId, "Model request", data.input));
    answerExecuteCall(this.engine, sid, data.call_id, (onEvent) =>
      this.answerer.execute(data.input, this.options.customProvider, onEvent, this.options.signal),
    );
  }

  private requestPermission(request: ToolPermissionRequest): void {
    void this.options.host
      .requestPermission(permissionPrompt(request, this.sessionId ?? ""), this.options.signal)
      .then((decision) => {
        if (this.settled || !this.sessionId) return;
        return this.engine.mutate(this.sessionId, { type: "resolve_permission", payload: { id: request.id, decision: permissionDecision(decision) } });
      })
      .catch(ignoreFailure(`answering permission request ${request.id}`));
  }
}
