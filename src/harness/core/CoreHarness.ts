// ============================================================
// CoreHarness.ts — One generic AgentHarness implementation over
// CoreEngineClient (Milestone B3), driven by a per-capability
// CoreCapabilityDefinition (definitions/). Mirrors SidecarHarness.ts's own
// shape: one run() implementation; everything capability-specific is data
// in a definition file, not a branch in here.
//
// This file is the contract definitions are written against; the run
// machinery behind it lives in run/ (CoreRun for a single-session run,
// singleShotSession for an orchestrating definition's sessions).
//
// Every core run creates its own rusty-core session and closes it once the
// run settles -- there is no cross-turn session reuse yet, so
// `releaseSession` is a no-op, matching contract/harness.ts's own "one run
// per session key, cleaned up on completion" allowance.
// ============================================================

import type {
  AgentHarness,
  CapabilityEvent,
  CapabilityInput,
  CapabilityName,
  CapabilityResult,
  RunHandle,
  RunHost,
  RunOutcome,
  TokenUsage,
  WorkflowRunOptions,
} from "../contract";
import type { HarnessControlPlane } from "../contract/controlPlane";
import { CoreEngineClient, type CoreEngine, type HostToolOutcome } from "./engine/CoreEngineClient";
import type { ExecutionEvent, ExecutionRequest, ExecutionResult } from "./engine/ExecutionProtocol";
import type { ExecutionParams, SessionRecipe } from "./SessionRecipe";
import type { Transcript } from "./transcript";
import { toolDecisionObserver } from "./toolDecisionObserver";
import type { FinishedStep } from "./workflowRun";
import { executionObservability } from "../../observability/executionStore";
import type { ExecutionOrigin } from "../../observability/types";
import type { ToolExecutionObserver } from "../contract/observability";
import { CoreRun } from "./run/CoreRun";
import { errorMessage, observe } from "./run/failures";
import { runSingleShotSession } from "./run/singleShotSession";
import { createUsageTracker, type UsageContext } from "./run/usageTracker";

/**
 * Answers one `HostExecuteCall` -- a single model turn -- on behalf of
 * whichever real provider the run's own `customProvider` names. This is
 * the seam a "host"-routed session's model execution actually happens
 * behind: `CoreHarness.ts` itself never knows or cares how (originally a
 * route on the now-removed Node sidecar, reusing its proven per-provider
 * request logic; today `HybridExecutionAnswerer` answers it directly via
 * `directExecution.ts`'s own ported per-provider request logic). Required,
 * not optional-with-a-default, so this file stays decoupled from any
 * specific implementation -- the real one is wired in by
 * src/harness/index.ts.
 */
export interface ExecutionAnswerer {
  execute(
    request: ExecutionRequest,
    customProvider: unknown,
    onEvent: (event: ExecutionEvent) => void,
    signal: AbortSignal,
  ): Promise<ExecutionResult>;
}

/** One model-facing tool a capability registers on its own recipe's
 * `host_tools`, executed IDE-side. See `CoreCapabilityDefinition.hostTools`'s
 * own doc comment. `observer` reports what happens inside this one call
 * (e.g. which model actually executed it) to Tool Execution Observability;
 * CoreHarness always supplies it, so it is optional only for direct calls
 * such as tests. */
export type HostToolHandler = (args: unknown, signal: AbortSignal, observer?: ToolExecutionObserver, call?: HostToolCall) => Promise<HostToolOutcome>;

/** Which tool call a handler is serving, for a tool that needs the calling
 * agent's own context (e.g. `decide` reads the agent's earlier steps). */
export interface HostToolCall {
  /** The IDE run id, as the `ToolDecisionObserver` sees it. */
  runId: string;
  sessionId: string;
  /** The model's tool call id, matching `ToolCallRequested.call.id`. */
  toolCallId?: string;
  /** Updates this session's execution params (e.g. its model). Applies
   * from the session's next model request; await it before returning the
   * tool result so that request already uses it. */
  configureExecution(params: ExecutionParams): Promise<void>;
}

/** Per-run mutable scratch space, fresh for every `run()` call and shared
 * across a definition's own `hostTools`/`toResult`/`onCompleted` calls --
 * the one thing those methods don't otherwise have, since each is invoked
 * independently with only `input`/`transcript` (both fixed for the whole
 * run). The first real need: execute_node's `write_file` handler records
 * which paths were actually written as tool calls come in, and `toResult`
 * needs to read that list back once the run completes -- a plain
 * `Record<string, unknown>` rather than a typed field per definition,
 * since only a handful of definitions need this at all and each one owns
 * its own key naming. */
export interface RunContext {
  scratch: Record<string, unknown>;
}

export interface WorkflowBoundaryContext<K extends CapabilityName> {
  input: CapabilityInput<K>;
  host: RunHost;
  ctx: RunContext;
  onEvent: (event: CapabilityEvent<K>) => void;
  signal: AbortSignal;
  /** The step that just finished. */
  step: { id: string; name: string };
  /** Every agent step finished so far, in order, with its output as text. */
  finished: FinishedStep[];
  /** The agent steps still to run, by name. */
  remaining: string[];
  /** The request the workflow was started with. */
  request: string;
}

export type WorkflowBoundaryDecision = { type: "continue" } | { type: "switch"; outcome: unknown };

export { enrichedRecipe, RECIPE_ENRICHMENT_DEADLINE_MS } from "./run/recipeEnrichment";

export interface CoreCapabilityDefinition<K extends CapabilityName> {
  readonly capability: K;
  /** Whether this capability can run on core at all for this specific
   * input (e.g. inline_chat's provider must map to a core integration --
   * HARNESS_CONTRACT_PLAN.md decision 5). Defaults to true when omitted. */
  supports?(input: CapabilityInput<K>): boolean;
  /** Builds the SessionRecipe this run's session is created with. May
   * throw (CoreHarness.run() catches it the same way a createSession
   * rejection is caught) -- the one useful case is `supports()` having been
   * skipped by a caller that dispatches without checking it first. Optional
   * only for an `orchestrate` definition (below), which builds its own
   * recipe per `runSession` call instead of one for the whole run; every
   * other definition must provide this -- `run()` throws synchronously if
   * neither `orchestrate` nor this (with `promptText`) is present. */
  recipe?(input: CapabilityInput<K>): SessionRecipe;
  /** Adds to the recipe something that can only be known asynchronously, such
   * as what the workspace holds on disk. Runs once per run, after `recipe()`
   * and before the session is created, and returns the recipe to use.
   *
   * It is an enhancement, never a requirement, so `CoreHarness` holds it to
   * `RECIPE_ENRICHMENT_DEADLINE_MS` and uses the plain recipe when it throws,
   * answers late, or answers nothing: it can delay a run by at most that
   * long and can never fail one. `signal` aborts when the run does. */
  enrichRecipe?(recipe: SessionRecipe, input: CapabilityInput<K>, host: RunHost, signal: AbortSignal): Promise<SessionRecipe | undefined>;
  /** The text of the run's first (and, for Milestone B, only) `"prompt"`
   * mutation. Optional for the same reason `recipe` is. */
  promptText?(input: CapabilityInput<K>): string;
  /** Turns the accumulated transcript into this capability's result shape,
   * once the run's session reports `Completed{outcome: "Success"}`. Takes
   * `input` too (not just the transcript) since a capability whose result
   * needs post-processing beyond raw text -- generate_skill's JSON parse
   * and its fallback spec, for one -- may need the original request (e.g.
   * a fallback description) that isn't in the model's own output. Optional
   * -- a capability that always defines `onCompleted` (below) never needs
   * this; `CoreHarness` uses `onCompleted` when present and falls back to
   * `toResult` otherwise, so a definition provides exactly one of the two. */
  toResult?(transcript: Transcript, input: CapabilityInput<K>, ctx: RunContext): CapabilityResult<K>;
  /** Takes over from `toResult` when a `Completed{Success}` event fires,
   * for a capability whose response may need retrying in the same session
   * before it has a final result (generate_task_nodes: the model's JSON
   * can come back malformed or empty, and the sidecar's own behavior
   * retries once with a stricter instruction before giving up). Return
   * `{done: true, result}` to settle the run normally, or `{done: false,
   * promptText}` to send another `"prompt"` mutation in the same session
   * and wait for the next `Completed` before asking again -- the
   * definition owns when to stop retrying (see generate_task_nodes.ts's
   * own attempt cap); `CoreHarness` enforces only a defensive ceiling
   * against a definition that never returns `done: true`. May throw, same
   * as `toResult` -- both are caught the same way, settling the run as
   * failed rather than leaving it hanging forever. */
  onCompleted?(
    transcript: Transcript,
    input: CapabilityInput<K>,
    attempt: number,
    ctx: RunContext,
  ): { done: true; result: CapabilityResult<K> } | { done: false; promptText: string };
  /** Model-facing tools this capability registers on its own recipe's
   * `host_tools` -- keyed by tool name, each handler runs IDE-side.
   * Consulted by CoreHarness's own `host_tool_call` dispatch for any tool
   * name that isn't one of the two Workspace-trait calls every session
   * answers the same way regardless of capability
   * ("workspace.read"/"workspace.write"). Registering a tool here needs
   * nothing from rusty-core -- `SessionBuilder::tools()` and `.backend()`
   * are independent builder fields (HARNESS_CONTRACT_PLAN.md's U1
   * re-diagnosis); this is purely an IDE-side dispatch table. Optional -- a
   * capability that registers no host_tools on its recipe never needs
   * this. Called once per run (lazily, on the first host tool call it
   * needs to answer) and cached for the rest of the run -- not once per
   * call -- so a handler's closure over `ctx.scratch` accumulates across
   * multiple tool calls instead of resetting on every one. `onEvent` is
   * the run's own event sink -- agent_chat's `report_progress` tool is
   * the first that needs to surface something to the UI directly from a
   * tool call rather than through the model's own text stream. */
  hostTools?(
    input: CapabilityInput<K>,
    host: RunHost,
    ctx: RunContext,
    onEvent: (event: CapabilityEvent<K>) => void,
  ): Record<string, HostToolHandler>;
  /** Called with every model request the IDE is about to answer, so a
   * capability can change how it runs -- AUTO picks a model per workflow
   * step here. Return the request to send (the same one when nothing
   * changes). It may take a moment (the model turn waits for it) but must
   * not throw: a rejection is ignored and the original request is sent. */
  prepareExecution?(
    request: ExecutionRequest,
    input: CapabilityInput<K>,
    ctx: RunContext,
    onEvent: (event: CapabilityEvent<K>) => void,
    signal: AbortSignal,
  ): Promise<ExecutionRequest> | ExecutionRequest;
  /** Whether this run may hand over to another workflow at a step boundary
   * (see `workflowBoundary`). Only then does the harness pause the run at the
   * start of each step that has another agent step after it. */
  switchesFlows?(input: CapabilityInput<K>): boolean;
  /** Called when an agent step of a workflow run has finished and another
   * agent step would follow. The run is paused meanwhile: it carries on only
   * when this returns `continue`. A `switch` ends the run (cancelled, keeping
   * what finished) and `workflowSwitched` turns its outcome into the result.
   * Must not throw: a failure is treated as `continue`. */
  workflowBoundary?(context: WorkflowBoundaryContext<K>): Promise<WorkflowBoundaryDecision>;
  /** The capability result for a run that handed over (`workflowBoundary`
   * returned `switch`). Required whenever `workflowBoundary` can. */
  workflowSwitched?(outcome: unknown, input: CapabilityInput<K>, ctx: RunContext): CapabilityResult<K>;
  /** workspaceRoot/model/provider for `controlPlane.recordUsage` -- kept
   * separate from `recipe()` because not everything a recipe needs
   * (`integration_config` carries secrets) belongs in a usage ledger. */
  usageContext(input: CapabilityInput<K>): { workspaceRoot: string; model: string; provider?: string };
  /** A workflow to run on this run's session instead of prompting it
   * (`undefined` for a normal agent loop). The session is created from
   * `recipe()` as usual, so the workflow's agent steps share its backend,
   * tools and host tool handlers. */
  workflow?(input: CapabilityInput<K>): { definition: unknown; input: unknown; checkpoint?: unknown; options?: WorkflowRunOptions } | undefined;
  /** The capability result for a completed workflow's final output.
   * Required whenever `workflow` can return a workflow. */
  workflowResult?(output: unknown, input: CapabilityInput<K>, ctx: RunContext): CapabilityResult<K>;
  /** Takes over the entire run for a capability that needs more than one
   * rusty-core session -- reconciliate_graph: one independent session per
   * overlapping file, run in sequence, not a single session's tool loop.
   * When present, `CoreHarness.run()` calls this INSTEAD of the normal
   * `recipe()`/`promptText()`/`toResult()`/`hostTools()`/`onCompleted()`
   * flow -- a definition provides `orchestrate` or those, never both; they
   * don't compose, since there's no single session for `hostTools`'s
   * per-run caching or `RunContext` to describe. `runSession` is the same
   * "create a session, send one prompt, dispatch its tool calls, wait for
   * Completed" primitive the normal single-session path uses internally
   * (`runSingleShotSession`, run/singleShotSession.ts), exposed here so an orchestrating
   * definition can call it as many times as it needs. It deliberately
   * doesn't support `onCompleted`'s same-session retry loop or
   * `RunContext` -- no orchestrate capability needs either yet; add them
   * if one does, rather than guessing at the shape now. */
  orchestrate?(context: {
    input: CapabilityInput<K>;
    host: RunHost;
    onEvent: (event: CapabilityEvent<K>) => void;
    signal: AbortSignal;
    runSession(session: {
      recipe: SessionRecipe;
      promptText: string;
      hostTools?: Record<string, HostToolHandler>;
      onToken?: (content: string) => void;
      onLog?: (message: string) => void;
      onUsage?: (usage: TokenUsage) => void;
    }): Promise<Transcript>;
  }): Promise<CapabilityResult<K>>;
}

export class CoreHarness implements AgentHarness {
  readonly id = "core";

  private readonly engine: CoreEngine;
  private readonly controlPlane: HarnessControlPlane;
  private readonly executionAnswerer: ExecutionAnswerer;
  private readonly definitions: { [K in CapabilityName]?: CoreCapabilityDefinition<K> };
  private readonly usageListeners = new Set<(runId: string, usage: TokenUsage) => void>();

  constructor(options: {
    controlPlane: HarnessControlPlane;
    executionAnswerer: ExecutionAnswerer;
    engine?: CoreEngine;
    definitions: { [K in CapabilityName]?: CoreCapabilityDefinition<K> };
  }) {
    this.engine = options.engine ?? new CoreEngineClient();
    this.controlPlane = options.controlPlane;
    this.executionAnswerer = options.executionAnswerer;
    this.definitions = options.definitions;
  }

  supports<K extends CapabilityName>(capability: K, input: CapabilityInput<K>): boolean {
    const definition = this.definitions[capability] as CoreCapabilityDefinition<K> | undefined;
    if (!definition) return false;
    return definition.supports ? definition.supports(input) : true;
  }

  run<K extends CapabilityName>(
    capability: K,
    input: CapabilityInput<K>,
    host: RunHost,
    onEvent: (event: CapabilityEvent<K>) => void,
    origin?: Partial<ExecutionOrigin>,
  ): RunHandle<K> {
    const definition = this.definitions[capability] as CoreCapabilityDefinition<K> | undefined;
    if (!definition) {
      throw new Error(`CoreHarness: no definition registered for capability "${capability}".`);
    }
    if (definition.orchestrate) {
      return this.runOrchestrated(definition, input, host, onEvent, origin);
    }
    if (!definition.recipe || !definition.promptText) {
      throw new Error(`CoreHarness: capability "${capability}"'s definition provides neither orchestrate() nor recipe()/promptText().`);
    }
    return new CoreRun({
      capability,
      definition,
      input,
      host,
      onEvent,
      origin,
      engine: this.engine,
      executionAnswerer: this.executionAnswerer,
      trackUsage: (runId) => this.usageTracker(runId, capability, definition.usageContext(input)),
    }).start();
  }

  /** The `orchestrate`-capability counterpart to the single-session `run()`
   * above. No single session's `createSession` to gate `started` on, so it
   * resolves immediately -- there's nothing more meaningful to wait for
   * before an orchestrating definition starts calling `runSession` itself.
   * `done` settles once `definition.orchestrate` either resolves (its
   * return value is the run's result) or rejects (mapped to `"cancelled"`
   * if the run's own `AbortController` had already been told to abort, or
   * `"failed"` otherwise -- `runSession` itself rejects with a
   * `DOMException("AbortError")` on cancellation, so an orchestrating
   * definition never has to distinguish the two on its own). */
  private runOrchestrated<K extends CapabilityName>(
    definition: CoreCapabilityDefinition<K>,
    input: CapabilityInput<K>,
    host: RunHost,
    onEvent: (event: CapabilityEvent<K>) => void,
    origin?: Partial<ExecutionOrigin>,
  ): RunHandle<K> {
    const runId = crypto.randomUUID();
    observe(() => executionObservability.startRun(runId, definition.capability, input, origin));
    const controller = new AbortController();
    let settled = false;
    let resolveDone!: (outcome: RunOutcome<K>) => void;
    const done = new Promise<RunOutcome<K>>((resolve) => (resolveDone = resolve));
    const settle = (outcome: RunOutcome<K>) => {
      if (settled) return;
      settled = true;
      observe(() => executionObservability.finishRun(runId, outcome));
      observe(() => toolDecisionObserver()?.endRun(runId));
      resolveDone(outcome);
    };

    const usage = this.usageTracker(runId, definition.capability, definition.usageContext(input));
    const runSession = (session: {
      recipe: SessionRecipe;
      promptText: string;
      hostTools?: Record<string, HostToolHandler>;
      onToken?: (content: string) => void;
      onLog?: (message: string) => void;
      onUsage?: (usage: TokenUsage) => void;
    }): Promise<Transcript> =>
      runSingleShotSession(this.engine, this.executionAnswerer, {
        recipe: session.recipe,
        promptText: session.promptText,
        hostTools: session.hostTools ?? {},
        host,
        customProvider: input.customProvider,
        onToken: session.onToken,
        onLog: session.onLog,
        onUsage: (envelope, snapshot) => {
          const model = session.recipe.execution_params?.model ?? definition.usageContext(input).model;
          session.onUsage?.(usage.session(envelope, snapshot, model));
        },
        toolObserver: usage.tool,
        signal: controller.signal,
        ideRunId: runId,
        capability: definition.capability,
      });

    void (async () => {
      try {
        const result = await definition.orchestrate!({ input, host, onEvent, signal: controller.signal, runSession });
        settle({ status: "completed", result });
      } catch (error: unknown) {
        settle(
          controller.signal.aborted
            ? { status: "cancelled" }
            : { status: "failed", error: { code: "CORE_ORCHESTRATION_FAILED", message: errorMessage(error) } },
        );
      }
    })();

    return {
      runId,
      started: Promise.resolve(),
      done,
      cancel: () => {
        if (settled) return;
        controller.abort();
        settle({ status: "cancelled" });
      },
    };
  }

  /** One run's usage accounting, reporting to Token Metrics and `subscribeUsage` listeners. */
  private usageTracker(runId: string, surface: string, context: UsageContext) {
    return createUsageTracker(runId, surface, context, {
      recordUsage: (sample) => this.controlPlane.recordUsage(sample),
      notify: (key, total) => {
        for (const listener of this.usageListeners) listener(key, total);
      },
    });
  }

  subscribeUsage(listener: (runId: string, usage: TokenUsage) => void): () => void {
    this.usageListeners.add(listener);
    return () => this.usageListeners.delete(listener);
  }

  async releaseSession(_sessionKey: string): Promise<void> {
    // Every core run creates and closes its own session (see the
    // class-level doc comment) -- nothing keyed by a UI session id to
    // release yet.
  }
}
