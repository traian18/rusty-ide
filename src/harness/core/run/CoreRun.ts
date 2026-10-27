// One capability run on its own rusty-core session: creates the session,
// routes its events, answers its calls into the IDE, and settles the run
// once. Every core run creates its own session and closes it once the run
// settles.

import type { AgentEvent, AgentEventEnvelope, PermissionDecision, ToolCall, ToolResultSummary } from "@rusty/harness-sdk";
import type { CapabilityEvent, CapabilityInput, CapabilityName, RunHandle, RunHost, RunOutcome } from "../../contract";
import type { ExecutionOrigin } from "../../../observability/types";
import { executionObservability } from "../../../observability/executionStore";
import { trajectories } from "../../../observability/trajectoryStore";
import type { CoreCapabilityDefinition, ExecutionAnswerer, HostToolHandler, RunContext } from "../CoreHarness";
import { compactionRecipe, isContextSummaryRequest } from "../contextCompaction";
import type { ContextCompactionRunConfig } from "../decideToolConfig";
import type { BridgeEvent, CoreEngine } from "../engine/CoreEngineClient";
import type { ExecutionEvent, ExecutionRequest, ExecutionResult } from "../engine/ExecutionProtocol";
import { changedPathsFromTool } from "../fileChangeTracking";
import { appliedModel } from "../appliedModels";
import { CONTINUE_AGENT_PROMPT, IncompleteAgentRun } from "../incompleteAgentRun";
import type { ExecutionParams, SessionRecipe } from "../SessionRecipe";
import { toolDecisionObserver } from "../toolDecisionObserver";
import { createTranscript } from "../transcript";
import { mapModelUsage } from "../usageAccumulator";
import {
  BEHAVIOR_LOGS,
  dispatchAgentEvent,
  dispatchBridgeEvent,
  isChildOwnedEvent,
  toolCallDetail,
  toolCompletedMessage,
  type AgentEventHandlers,
  type BridgeEventHandlers,
} from "./agentEvents";
import { errorMessage, ignoreFailure, observe, reportIgnored } from "./failures";
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
import { enrichedRecipe } from "./recipeEnrichment";
import type { UsageTracker } from "./usageTracker";
import { WorkflowDriver } from "./WorkflowDriver";
import type { WorkflowRunAccess } from "./workflowRunAccess";

// A definition with a bug that never returns `done: true` would otherwise
// retry forever -- this is a backstop, not a real per-capability limit (each
// definition owns its own, tighter cap; see generate_task_nodes.ts's
// 2-attempt one).
const MAX_ONCOMPLETED_ATTEMPTS = 10;

export interface CoreRunOptions<K extends CapabilityName> {
  capability: K;
  /** Provides `recipe()` and `promptText()`; `CoreHarness.run()` checks that. */
  definition: CoreCapabilityDefinition<K>;
  input: CapabilityInput<K>;
  host: RunHost;
  onEvent: (event: CapabilityEvent<K>) => void;
  origin?: Partial<ExecutionOrigin>;
  engine: CoreEngine;
  executionAnswerer: ExecutionAnswerer;
  trackUsage: (runId: string) => UsageTracker;
}

export class CoreRun<K extends CapabilityName> implements WorkflowRunAccess<K> {
  readonly runId = crypto.randomUUID();
  private readonly controller = new AbortController();
  /** Aborts when the run settles, so what a definition started for it (a background job) ends with it. */
  readonly context: RunContext = { scratch: {}, signal: this.controller.signal };
  readonly capability: K;
  readonly definition: CoreCapabilityDefinition<K>;
  readonly input: CapabilityInput<K>;
  readonly host: RunHost;
  readonly onEvent: (event: CapabilityEvent<K>) => void;
  readonly engine: CoreEngine;
  private readonly executionAnswerer: ExecutionAnswerer;
  private readonly transcript = createTranscript();
  private readonly incompleteAgentRun: IncompleteAgentRun | undefined;
  private readonly pendingFileChanges = new Map<string, string[]>();
  private readonly started: Promise<void>;
  private readonly done: Promise<RunOutcome<K>>;
  private readonly usage: UsageTracker;
  private readonly workflow: WorkflowDriver<K>;
  private resolveStarted!: () => void;
  private rejectStarted!: (error: Error) => void;
  private resolveDone!: (outcome: RunOutcome<K>) => void;
  private settled = false;
  private currentSession: string | undefined;
  // Only advanced by definition.onCompleted's own retry decision -- 1 for
  // every capability that doesn't define onCompleted at all.
  private attempt = 1;
  // Built lazily, on the first host_tool_call this run needs to answer, and
  // cached for the rest of the run -- see hostTools's own doc comment on why
  // this must not be rebuilt per call.
  private toolHandlers: Record<string, HostToolHandler> | undefined;

  constructor(options: CoreRunOptions<K>) {
    this.capability = options.capability;
    this.definition = options.definition;
    this.input = options.input;
    this.host = options.host;
    this.onEvent = options.onEvent;
    this.engine = options.engine;
    this.executionAnswerer = options.executionAnswerer;
    observe(() => executionObservability.startRun(this.runId, this.capability, this.input, options.origin));
    this.incompleteAgentRun = this.capability === "agent_chat" ? new IncompleteAgentRun() : undefined;
    this.started = new Promise<void>((resolve, reject) => {
      this.resolveStarted = resolve;
      this.rejectStarted = reject;
    });
    // A `started` rejection nothing awaits must not surface as an unhandled
    // rejection -- `done` is the harness's own guaranteed observer of the
    // same failure (mirrors SidecarHarness.ts's identical note).
    this.started.catch(ignoreFailure("starting the run (reported through done)"));
    this.done = new Promise<RunOutcome<K>>((resolve) => (this.resolveDone = resolve));
    this.usage = options.trackUsage(this.runId);
    this.workflow = new WorkflowDriver(this);
  }

  /** Starts the session and returns the run's handle. */
  start(): RunHandle<K> {
    void this.open();
    return { runId: this.runId, started: this.started, done: this.done, cancel: () => this.cancel() };
  }

  get signal(): AbortSignal {
    return this.controller.signal;
  }

  sessionId(): string | undefined {
    return this.currentSession;
  }

  isSettled(): boolean {
    return this.settled;
  }

  isLive(): boolean {
    return !this.settled && !this.controller.signal.aborted;
  }

  log(message: string): void {
    this.onEvent({ kind: "log", message } as CapabilityEvent<K>);
  }

  settle(outcome: RunOutcome<K>): void {
    if (this.settled) return;
    this.settled = true;
    this.controller.abort();
    observe(() => executionObservability.finishRun(this.runId, outcome));
    observe(() => toolDecisionObserver()?.endRun(this.runId));
    this.resolveDone(outcome);
    if (this.currentSession) this.closeSession(this.currentSession);
  }

  private fail(code: string, message: string): void {
    this.settle({ status: "failed", error: { code, message } });
  }

  private closeSession(id: string): void {
    void this.engine.closeSession(id).catch(ignoreFailure(`closing session ${id}`));
  }

  private cancel(): void {
    if (this.settled) return;
    this.controller.abort();
    if (this.currentSession) void this.stopSession(this.currentSession).catch(ignoreFailure("cancelling the session"));
    this.settle({ status: "cancelled" });
  }

  private stopSession(id: string): Promise<void> {
    if (this.workflow.spec && this.engine.workflowControl) return this.engine.workflowControl(id, { type: "cancel" });
    return this.engine.mutate(id, { type: "cancel" });
  }

  // --- opening the session -------------------------------------------------

  /** Creates the session, subscribes to it, then prompts it or starts its workflow. */
  private async open(): Promise<void> {
    try {
      const recipe = this.withRunSettings(
        await enrichedRecipe(this.definition, this.definition.recipe!(this.input), this.input, this.host, this.controller.signal),
      );
      const id = await this.engine.createSession(recipe);
      if (this.settled) {
        // cancel() ran while createSession() was still in flight -- this run
        // never got far enough for settle()'s own cleanup (sessionId was
        // still unset) to close it.
        this.closeSession(id);
        return;
      }
      this.bindSession(id);
      await this.engine.subscribe(id, (event) => this.onBridgeEvent(event));
      this.resolveStarted();
      const spec = this.workflow.spec;
      if (spec) return await this.workflow.start(id, spec);
      await this.prompt(id, this.definition.promptText!(this.input));
    } catch (error: unknown) {
      const message = errorMessage(error);
      this.rejectStarted(new Error(message));
      this.fail("CORE_SESSION_FAILED", message);
    }
  }

  /** The definition's recipe with the run's workflow and context compaction added. */
  private withRunSettings(base: SessionRecipe): SessionRecipe {
    const withWorkflow = this.workflow.attachTo(base);
    const compaction = compactionRecipe(
      (this.input as { contextCompaction?: ContextCompactionRunConfig }).contextCompaction,
      this.input.customProvider,
      (this.input as { model?: unknown }).model,
    );
    const recipe: SessionRecipe = compaction ? { ...withWorkflow, context_compaction: compaction } : withWorkflow;
    observe(() => trajectories.append(this.runId, "Session context", {
      systemPrompt: recipe.system_prompt, prompt: this.definition.promptText!(this.input),
      integration: recipe.integration, executionParams: recipe.execution_params,
      tools: recipe.host_tools, workspace: recipe.workspace,
      contextVisibility: "Host model requests are recorded separately. Managed CLI internal prompts, compaction and hidden reasoning are not exposed by the CLI.",
    }));
    return recipe;
  }

  private bindSession(id: string): void {
    this.currentSession = id;
    observe(() => executionObservability.bindSession(this.runId, id, this.definition.usageContext(this.input).model));
    observe(() => toolDecisionObserver()?.beginSession(this.runId, id, {
      capability: this.capability, prompt: this.definition.promptText!(this.input), model: this.definition.usageContext(this.input).model,
    }));
  }

  private prompt(sessionId: string, text: string): Promise<void> {
    return this.engine.mutate(sessionId, { type: "prompt", payload: { text, attachments: [] } });
  }

  /** Another prompt in the same session; failing to send it fails the run. */
  private promptAgain(sessionId: string, text: string): void {
    void this.prompt(sessionId, text).catch((error: unknown) => this.fail("CORE_SESSION_FAILED", errorMessage(error)));
  }

  // --- session events ------------------------------------------------------

  private readonly bridgeHandlers: BridgeEventHandlers = {
    event: (envelope) => this.onAgentEvent(envelope),
    gap: (gap) => this.log(`Dropped ${gap.dropped} event(s) after a slow consumer.`),
    host_tool_call: (call) => this.answerHostTool(call),
    host_execute_call: (call) => this.answerModelTurn(call),
    closed: (closed) => this.fail("CORE_SESSION_CLOSED", closed.reason),
    workflow_event: (event) => this.workflow.onEvent(event),
    workflow_agent_event: (event) => this.workflow.onAgentEvent(event.envelope),
    workflow_finished: (finished) => this.workflow.onFinished(finished.state),
  };

  private onBridgeEvent(event: BridgeEvent): void {
    if (this.settled) return;
    dispatchBridgeEvent(this.bridgeHandlers, event);
  }

  // Variants without a handler -- StateChanged, RunStarted,
  // BackendRequestStarted, AssistantMessageStarted, AssistantMessageCompleted,
  // ToolCallStarted, ContextInjected (covered by BehaviorRuleFired),
  // ChildAgentSpawned, ChildAgentCompleted -- have no capability event to
  // surface yet. ReasoningDelta is already captured by observability: raw
  // model reasoning is not a user-facing progress update and must never
  // enter saved chat history.
  private readonly agentHandlers: AgentEventHandlers = {
    AssistantTextDelta: ({ message_id, delta }) => this.onTextDelta(message_id, delta),
    UsageUpdated: ({ usage }, envelope) => this.onUsage(usage, envelope),
    ToolCallRequested: ({ call }) => this.onToolCallRequested(call),
    ToolCallCompleted: ({ call_id, result }) => this.onToolCallCompleted(call_id, result),
    PermissionRequested: ({ request }) => this.requestPermission(request),
    Failed: ({ error }) => this.onFailed(error.code, error.message),
    Completed: ({ outcome }) => this.onCompleted(outcome),
    ProfileChanged: (change) => this.log(BEHAVIOR_LOGS.ProfileChanged(change)),
    BehaviorRuleFired: (fired) => this.log(BEHAVIOR_LOGS.BehaviorRuleFired(fired)),
    ToolCallDenied: (denied) => this.log(BEHAVIOR_LOGS.ToolCallDenied(denied)),
    CompletionGateEvaluated: (gate) => this.log(BEHAVIOR_LOGS.CompletionGateEvaluated(gate)),
  };

  onAgentEvent(envelope: AgentEventEnvelope): void {
    observe(() => executionObservability.ingest(this.runId, envelope));
    observe(() => toolDecisionObserver()?.observe(this.runId, envelope));
    if (this.settled || isChildOwnedEvent(envelope)) return;
    if (!envelope.parent_agent_id) this.incompleteAgentRun?.observe(envelope.event as AgentEvent);
    dispatchAgentEvent(this.agentHandlers, envelope);
  }

  private onTextDelta(messageId: string, delta: string): void {
    this.transcript.push(messageId, delta);
    this.onEvent({ kind: "token", content: delta, ...(this.capability === "agent_chat" ? { messageId } : {}) } as CapabilityEvent<K>);
  }

  private onUsage(snapshot: unknown, envelope: AgentEventEnvelope): void {
    // A workflow step switched to another model by AUTO is stamped with the
    // model core configured; account for the one that really ran.
    const ranOn = appliedModel(this.context.scratch, envelope.run_id);
    this.usage.session(envelope, ranOn ? { ...(snapshot as object), model: ranOn } : snapshot);
    // The run's own display counts everything its agents spent, subagents included.
    this.onEvent({ kind: "usage", usage: this.usage.runTotal() } as CapabilityEvent<K>);
  }

  private onToolCallRequested(call: ToolCall): void {
    this.workflow.researchRequested(call);
    const workspaceRoot = typeof this.input.workspaceRoot === "string" ? this.input.workspaceRoot : "";
    const paths = changedPathsFromTool(call.name, call.arguments, workspaceRoot);
    if (paths.length > 0) this.pendingFileChanges.set(call.id, paths);
    this.log(`Calling ${call.name}${toolCallDetail(call.arguments)}...`);
  }

  private onToolCallCompleted(callId: string, result: ToolResultSummary): void {
    this.workflow.researchAnswered(callId, result.has_error);
    this.recordFileChanges(callId, result.has_error);
    this.log(toolCompletedMessage(result));
  }

  private recordFileChanges(callId: string, failed: boolean): void {
    const paths = this.pendingFileChanges.get(callId) ?? [];
    this.pendingFileChanges.delete(callId);
    if (failed || paths.length === 0) return;
    const modifiedFiles = (this.context.scratch.modifiedFiles ??= new Set<string>()) as Set<string>;
    paths.forEach((path) => modifiedFiles.add(path));
    this.onEvent({ kind: "files_changed", paths } as CapabilityEvent<K>);
  }

  private onFailed(code: string, message: string): void {
    if (code === "OUTPUT_LIMIT_REACHED" && this.incompleteAgentRun) {
      this.incompleteAgentRun.outputLimitReached();
      this.completeSuccess();
      return;
    }
    this.fail(code, message);
  }

  private onCompleted(outcome: string): void {
    if (outcome === "Success") return this.completeSuccess();
    if (outcome === "Cancelled") return this.settle({ status: "cancelled" });
    this.fail("CORE_RUN_FAILED", "The run failed.");
  }

  // --- turning a completed session into a result ---------------------------

  private completeSuccess(): void {
    try {
      if (this.continuedIncomplete()) return;
      if (this.definition.onCompleted) return this.retryOrFinish();
      if (!this.definition.toResult) {
        // Neither hook is defined -- a genuinely misconfigured definition
        // (every real one provides exactly one), not a runtime condition a
        // capability can trigger.
        return this.fail("CORE_NO_RESULT_HANDLER", "This capability defines neither toResult nor onCompleted.");
      }
      this.settle({ status: "completed", result: this.definition.toResult(this.transcript, this.input, this.context) });
    } catch (error: unknown) {
      // toResult/onCompleted threw (e.g. a capability's own JSON parse
      // failed even after retrying) -- without this, the run's `done` would
      // never settle at all.
      this.fail("CORE_RESULT_FAILED", errorMessage(error));
    }
  }

  /** An agent run that stopped before finishing its answer: continue it, or fail once continuations run out. */
  private continuedIncomplete(): boolean {
    const recovery = this.incompleteAgentRun?.completion();
    if (recovery === "exhausted") {
      this.fail("INCOMPLETE_AGENT_RUN", "The model did not finish its answer after two continuations. Its partial responses are preserved. Inspect the run trajectory for output limits or other details.");
      return true;
    }
    const sessionId = this.currentSession;
    if (recovery !== "continue" || !sessionId || this.controller.signal.aborted) return false;
    observe(() => trajectories.append(this.runId, "Automatic continuation", { prompt: CONTINUE_AGENT_PROMPT }));
    this.log("The model stopped before completing its answer; continuing the existing session…");
    this.promptAgain(sessionId, CONTINUE_AGENT_PROMPT);
    return true;
  }

  /** `onCompleted` either settles the run or asks for another prompt in the same session. */
  private retryOrFinish(): void {
    const outcome = this.definition.onCompleted!(this.transcript, this.input, this.attempt, this.context);
    if (outcome.done) return this.settle({ status: "completed", result: outcome.result });
    const sessionId = this.currentSession;
    if (this.attempt >= MAX_ONCOMPLETED_ATTEMPTS || !sessionId) {
      return this.fail("CORE_RUN_DID_NOT_CONVERGE", "The run did not produce a final result.");
    }
    this.attempt += 1;
    observe(() => trajectories.append(this.runId, "Continuation prompt", { prompt: outcome.promptText, attempt: this.attempt }));
    this.promptAgain(sessionId, outcome.promptText);
  }

  // --- calls from the session into the IDE ---------------------------------

  requestPermission(request: ToolPermissionRequest, resolve?: (decision: PermissionDecision) => Promise<void> | undefined): void {
    void this.host
      .requestPermission(permissionPrompt(request, this.currentSession ?? this.runId), this.controller.signal)
      .then((decision) => {
        if (this.settled || !this.currentSession) return;
        const mapped = permissionDecision(decision);
        if (resolve) return resolve(mapped);
        return this.engine.mutate(this.currentSession, { type: "resolve_permission", payload: { id: request.id, decision: mapped } });
      })
      .catch(ignoreFailure(`answering permission request ${request.id}`));
  }

  private answerHostTool(data: HostToolCallData): void {
    const sid = this.currentSession;
    if (!sid) return;
    if (answerWorkspaceTool(this.engine, this.host, sid, data, this.controller.signal)) return;
    // Every other tool name is capability-specific -- whatever the definition
    // itself registered on recipe().host_tools.
    const handler = this.hostToolHandlers()[data.tool];
    if (!handler) return failUnhandledTool(this.engine, sid, data);
    // Where the call came from: a workflow step's session shares this
    // session's tools, and its tool calls are recorded under that session --
    // so smart tools, decisions and risk review must look there too.
    const caller = data.session_id ?? sid;
    const outcome = handler(data.input, this.controller.signal, this.usage.tool(caller, data.tool_call_id, data.tool), {
      runId: this.runId,
      sessionId: caller,
      toolCallId: data.tool_call_id,
      configureExecution: (params) => this.configureExecution(sid, caller, params),
    });
    deliverToolOutcome(this.engine, sid, data.call_id, outcome);
  }

  private hostToolHandlers(): Record<string, HostToolHandler> {
    this.toolHandlers ??= this.definition.hostTools ? this.definition.hostTools(this.input, this.host, this.context, this.onEvent) : {};
    return this.toolHandlers;
  }

  /** A workflow step's session is reconfigured through its parent. */
  private configureExecution(sessionId: string, caller: string, params: ExecutionParams): Promise<void> {
    if (caller === sessionId) return this.engine.mutate(sessionId, { type: "configure_execution", payload: { params } });
    if (!this.engine.configureStepExecution) return Promise.reject(new Error("This build of the harness cannot reconfigure workflow steps."));
    return this.engine.configureStepExecution(sessionId, caller, params);
  }

  private answerModelTurn(data: HostExecuteCallData): void {
    const sid = this.currentSession;
    if (!sid) return;
    // rusty-core's background context summary: answered on the run's
    // provider like any turn, but never treated as a step's first turn, and
    // its tokens are accounted as their own surface.
    const contextSummary = isContextSummaryRequest(data.input);
    const recordSummaryUsage = (result: ExecutionResult) =>
      this.usage.background(data.input.params?.model ?? this.definition.usageContext(this.input).model, mapModelUsage(result.usage), "context_summary");
    answerExecuteCall(this.engine, sid, data.call_id, (onEvent) => this.runModelTurn(data.input, contextSummary, onEvent), contextSummary ? recordSummaryUsage : undefined);
  }

  /** The capability may adjust the request first (a per-step model), and the
   * turn waits for it; a failure there never costs the model turn. Without
   * that hook the answerer starts synchronously, as it always has. */
  private runModelTurn(request: ExecutionRequest, contextSummary: boolean, onEvent: (event: ExecutionEvent) => void): Promise<ExecutionResult> {
    const execute = (prepared: ExecutionRequest) => this.execute(prepared, contextSummary, onEvent);
    if (!this.definition.prepareExecution || contextSummary) return execute(request);
    return Promise.resolve()
      .then(() => this.definition.prepareExecution!(request, this.input, this.context, this.onEvent, this.controller.signal))
      .catch((error: unknown) => {
        reportIgnored("preparing the model request", error);
        return request;
      })
      .then(execute);
  }

  private execute(request: ExecutionRequest, contextSummary: boolean, onEvent: (event: ExecutionEvent) => void): Promise<ExecutionResult> {
    observe(() => trajectories.append(this.runId, contextSummary ? "Context summary request" : "Model request", request));
    try {
      return this.executionAnswerer.execute(request, this.input.customProvider, onEvent, this.controller.signal);
    } catch (error: unknown) {
      return Promise.reject(error);
    }
  }
}
