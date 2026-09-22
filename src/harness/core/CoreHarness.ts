// ============================================================
// CoreHarness.ts — One generic AgentHarness implementation over
// CoreEngineClient (Milestone B3), driven by a per-capability
// CoreCapabilityDefinition (definitions/). Mirrors SidecarHarness.ts's own
// shape: one run() implementation; everything capability-specific is data
// in a definition file, not a branch in here.
//
// Every core run creates its own rusty-core session and closes it once the
// run settles -- there is no cross-turn session reuse yet, so
// `releaseSession` is a no-op, matching contract/harness.ts's own "one run
// per session key, cleaned up on completion" allowance.
// ============================================================

import { trajectories } from "../../observability/trajectoryStore";
import { IncompleteAgentRun, CONTINUE_AGENT_PROMPT } from "./incompleteAgentRun";
import { changedPathsFromTool } from "./fileChangeTracking";
import type { AgentEvent, AgentEventEnvelope, AgentUsageSnapshot, PermissionDecision } from "@rusty/harness-sdk";

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
} from "../contract";
import type { HarnessControlPlane, UsageRecordSample } from "../contract/controlPlane";
import { CoreEngineClient, type BridgeEvent, type CoreEngine, type HostToolOutcome } from "./engine/CoreEngineClient";
import { isExecutionError, type ExecutionError, type ExecutionEvent, type ExecutionRequest, type ExecutionResult } from "./engine/ExecutionProtocol";
import type { SessionRecipe } from "./SessionRecipe";
import { createTranscript, type Transcript } from "./transcript";
import { executionObservability } from "../../observability/executionStore";
import type { ExecutionOrigin } from "../../observability/types";

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

function toExecutionError(error: unknown): ExecutionError {
  // A rejection from a real ExecutionAnswerer (SidecarExecutionAnswerer's
  // own catch blocks, both the sidecar-reported-error path and its
  // connection-failure fallback) is already a well-formed ExecutionError --
  // pass it straight through rather than re-wrapping it, which would
  // stringify an object via errorMessage() into the useless
  // "[object Object]" and discard the real message underneath. Only a
  // genuinely unexpected rejection (a thrown DOMException on abort, or
  // anything not shaped like ExecutionError) falls through to the generic
  // wrapper below.
  if (isExecutionError(error)) return error;
  return { BackendError: { message: errorMessage(error), code: "HOST_EXECUTE_ANSWERER_FAILED" } };
}

/** One model-facing tool a capability registers on its own recipe's
 * `host_tools`, executed IDE-side. See `CoreCapabilityDefinition.hostTools`'s
 * own doc comment. */
export type HostToolHandler = (args: unknown, signal: AbortSignal) => Promise<HostToolOutcome>;

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
  /** workspaceRoot/model/provider for `controlPlane.recordUsage` -- kept
   * separate from `recipe()` because not everything a recipe needs
   * (`integration_config` carries secrets) belongs in a usage ledger. */
  usageContext(input: CapabilityInput<K>): { workspaceRoot: string; model: string; provider?: string };
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
   * (`CoreHarness.runSingleShotSession`), exposed here so an orchestrating
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

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Observability is deliberately fail-open: recording a run is useful, but
 * it must never become part of the provider's execution contract. Browser
 * storage, payload sanitization, or a UI subscriber can all fail independently
 * of rusty-core, and none of those failures may stop a Claude/Codex/Copilot
 * session from starting or consuming its events. */
function observe(action: () => void): void {
  try {
    action();
  } catch (error) {
    console.warn("Execution observability failed without affecting the run:", error);
  }
}

function parseTokenCount(val: unknown): number | undefined {
  if (typeof val === "number" && !isNaN(val)) return val;
  if (Array.isArray(val) && typeof val[0] === "number" && !isNaN(val[0])) return val[0];
  if (val && typeof val === "object") {
    const raw = (val as Record<string, unknown>)[0] ?? (val as Record<string, unknown>).value;
    if (typeof raw === "number" && !isNaN(raw)) return raw;
  }
  return undefined;
}

function mapUsage(snapshot: AgentUsageSnapshot): TokenUsage {
  const metrics = snapshot.metrics as Record<string, unknown> | undefined;
  const total = parseTokenCount(metrics?.total_tokens);
  const input = parseTokenCount(metrics?.input_tokens);
  const output = parseTokenCount(metrics?.output_tokens);
  const cacheRead = parseTokenCount(metrics?.cache_read_tokens);
  const cacheWrite = parseTokenCount(metrics?.cache_write_tokens);
  return {
    totalTokens: total ?? (input !== undefined || output !== undefined ? (input || 0) + (output || 0) : undefined),
    input,
    output,
    cacheRead,
    cacheWrite,
  };
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

    const runId = crypto.randomUUID();
    observe(() => executionObservability.startRun(runId, capability, input, origin));
    const controller = new AbortController();
    const transcript = createTranscript();
    const incompleteAgentRun = capability === "agent_chat" ? new IncompleteAgentRun() : undefined;
    const runContext: RunContext = { scratch: {} };
    const pendingFileChanges = new Map<string, string[]>();
    let settled = false;
    let sessionId: string | undefined;
    // Only advanced by definition.onCompleted's own retry decision -- 1 for
    // every capability that doesn't define onCompleted at all.
    let attempt = 1;
    // Built lazily, on the first host_tool_call this run needs to answer,
    // and cached for the rest of the run -- see hostTools's own doc
    // comment on why this must not be rebuilt per call.
    let hostToolHandlers: Record<string, HostToolHandler> | undefined;
    const getHostToolHandlers = (): Record<string, HostToolHandler> => {
      if (!hostToolHandlers) hostToolHandlers = definition.hostTools ? definition.hostTools(input, host, runContext, onEvent) : {};
      return hostToolHandlers;
    };

    let resolveStarted!: () => void;
    let rejectStarted!: (error: Error) => void;
    let resolveDone!: (outcome: RunOutcome<K>) => void;
    const started = new Promise<void>((resolve, reject) => {
      resolveStarted = resolve;
      rejectStarted = reject;
    });
    // A `started` rejection nothing awaits must not surface as an unhandled
    // rejection -- `done` is the harness's own guaranteed observer of the
    // same failure (mirrors SidecarHarness.ts's identical note).
    started.catch(() => {});
    const done = new Promise<RunOutcome<K>>((resolve) => (resolveDone = resolve));

    const settle = (outcome: RunOutcome<K>) => {
      if (settled) return;
      settled = true;
      controller.abort();
      observe(() => executionObservability.finishRun(runId, outcome));
      resolveDone(outcome);
      if (sessionId) void this.engine.closeSession(sessionId).catch(() => {});
    };

    // A definition with a bug that never returns `done: true` would
    // otherwise retry forever -- this is a backstop, not a real per-
    // capability limit (each definition owns its own, tighter cap; see
    // generate_task_nodes.ts's 2-attempt one).
    const MAX_ONCOMPLETED_ATTEMPTS = 10;

    const handleCompletedSuccess = () => {
      try {
        const recovery = incompleteAgentRun?.completion();
        if (recovery === "exhausted") {
          settle({ status: "failed", error: { code: "INCOMPLETE_AGENT_RUN", message: "The model did not finish its answer after two continuations. Its partial responses are preserved. Inspect the run trajectory for output limits or other details." } });
          return;
        }
        if (recovery === "continue" && sessionId && !controller.signal.aborted) {
          observe(() => trajectories.append(runId, "Automatic continuation", { prompt: CONTINUE_AGENT_PROMPT }));
          onEvent({ kind: "log", message: "The model stopped before completing its answer; continuing the existing session…" } as CapabilityEvent<K>);
          void this.engine.mutate(sessionId, { type: "prompt", payload: { text: CONTINUE_AGENT_PROMPT, attachments: [] } })
            .catch((error: unknown) => settle({ status: "failed", error: { code: "CORE_SESSION_FAILED", message: errorMessage(error) } }));
          return;
        }
        if (definition.onCompleted) {
          const outcome = definition.onCompleted(transcript, input, attempt, runContext);
          if (outcome.done) {
            settle({ status: "completed", result: outcome.result });
            return;
          }
          if (attempt >= MAX_ONCOMPLETED_ATTEMPTS || !sessionId) {
            settle({
              status: "failed",
              error: { code: "CORE_RUN_DID_NOT_CONVERGE", message: "The run did not produce a final result." },
            });
            return;
          }
          attempt += 1;
          observe(() => trajectories.append(runId, "Continuation prompt", { prompt: outcome.promptText, attempt }));
          const sid = sessionId;
          void this.engine
            .mutate(sid, { type: "prompt", payload: { text: outcome.promptText, attachments: [] } })
            .catch((error: unknown) => {
              settle({ status: "failed", error: { code: "CORE_SESSION_FAILED", message: errorMessage(error) } });
            });
          return;
        }
        if (!definition.toResult) {
          // Neither hook is defined -- a genuinely misconfigured
          // definition (every real one provides exactly one), not a
          // runtime condition a capability can trigger.
          settle({
            status: "failed",
            error: { code: "CORE_NO_RESULT_HANDLER", message: "This capability defines neither toResult nor onCompleted." },
          });
          return;
        }
        settle({ status: "completed", result: definition.toResult(transcript, input, runContext) });
      } catch (error: unknown) {
        // toResult/onCompleted threw (e.g. a capability's own JSON parse
        // failed even after retrying) -- without this, the run's `done`
        // would never settle at all.
        settle({ status: "failed", error: { code: "CORE_RESULT_FAILED", message: errorMessage(error) } });
      }
    };

    const recordUsage = (usage: TokenUsage) => {
      const context = definition.usageContext(input);
      const sample: UsageRecordSample = {
        workspaceRoot: context.workspaceRoot,
        surface: capability,
        runId,
        provider: context.provider,
        model: context.model,
        usage: {
          input: usage.input ?? 0,
          output: usage.output ?? 0,
          cacheRead: usage.cacheRead ?? 0,
          cacheWrite: usage.cacheWrite ?? 0,
          totalTokens: usage.totalTokens ?? ((usage.input ?? 0) + (usage.output ?? 0)),
        },
      };
      void this.controlPlane.recordUsage(sample).catch(() => {});
    };

    const handlePermissionRequested = (request: {
      id: string;
      tool_call: { id: string; name: string; arguments: unknown };
    }) => {
      const args = request.tool_call.arguments;
      void host
        .requestPermission(
          {
            requestId: request.id,
            sessionId: sessionId ?? runId,
            // A core ToolCall has no shell-shaped command today -- best
            // effort until Milestone C registers a real shell.exec tool
            // (HARNESS_CONTRACT_PLAN.md's Milestone C table) with an actual
            // program/args/cwd to report here. Dead code for every
            // registered host_tool so far (global_explore's read/
            // list_files/search_codebase are all PermissionMode::Allow, so
            // no PermissionRequested ever fires for them), kept so a later
            // tool needing PermissionMode::Ask doesn't have to add this
            // wiring itself.
            command: {
              program: request.tool_call.name,
              args: Array.isArray(args) ? args.map(String) : [],
              cwd: "",
              timeoutMs: 0,
            },
            risk: "normal",
            sessionGrantScope: "exact_command",
            sessionGrantProgram: request.tool_call.name,
            description: `Allow "${request.tool_call.name}"?`,
          },
          controller.signal,
        )
        .then((decision) => {
          if (settled || !sessionId) return;
          const mapped: PermissionDecision = decision === "deny" ? "Denied" : "Approved";
          return this.engine.mutate(sessionId, { type: "resolve_permission", payload: { id: request.id, decision: mapped } });
        })
        .catch(() => {});
    };

    const handleHostToolCall = (data: { call_id: string; tool: string; input: unknown }) => {
      if (!sessionId) return;
      const sid = sessionId;
      if (data.tool === "workspace.read") {
        const path = String((data.input as { path?: unknown } | undefined)?.path ?? "");
        host
          .readFile(path, controller.signal)
          .then((content) => this.engine.hostToolResult(sid, data.call_id, { ok: true, output: { content } }))
          .catch((error: unknown) => this.engine.hostToolResult(sid, data.call_id, { ok: false, error: errorMessage(error) }))
          .catch(() => {});
        return;
      }
      if (data.tool === "workspace.write") {
        const input = data.input as { path?: unknown; content?: unknown } | undefined;
        const path = String(input?.path ?? "");
        const content = String(input?.content ?? "");
        host
          .writeFile(path, content, controller.signal)
          .then(() => this.engine.hostToolResult(sid, data.call_id, { ok: true, output: {} }))
          .catch((error: unknown) => this.engine.hostToolResult(sid, data.call_id, { ok: false, error: errorMessage(error) }))
          .catch(() => {});
        return;
      }
      // Every other tool name is capability-specific -- whatever the
      // definition itself registered on recipe().host_tools (see
      // hostTools's own doc comment on CoreCapabilityDefinition).
      const handler = getHostToolHandlers()[data.tool];
      if (handler) {
        handler(data.input, controller.signal)
          .then((outcome) => this.engine.hostToolResult(sid, data.call_id, outcome))
          .catch((error: unknown) => this.engine.hostToolResult(sid, data.call_id, { ok: false, error: errorMessage(error) }))
          .catch(() => {});
        return;
      }
      // Registered on the recipe but the definition provides no handler for
      // it (a misconfigured definition) -- fail it so the model sees an
      // error rather than hanging on an unanswered call.
      void this.engine
        .hostToolResult(sid, data.call_id, { ok: false, error: `CoreHarness: no handler for host tool "${data.tool}".` })
        .catch(() => {});
    };

    const handleHostExecuteCall = (data: { call_id: string; tool: string; input: ExecutionRequest }) => {
      if (!sessionId) return;
      const sid = sessionId;
      observe(() => trajectories.append(runId, "Model request", data.input));
      // Every event and the terminal result are separate Tauri invokes,
      // and Tauri makes no ordering guarantee between independent invokes
      // -- so they are chained here to run strictly one after another. The
      // Rust side (`HostBridge::finish_stream`) removes the pending stream
      // when the result lands, after which `push_event` silently drops any
      // event for that call_id. Without this chain, a result invoke that
      // overtakes the preceding `ToolCallRequested` event loses the tool
      // call entirely: rusty-core sees `finish_reason: "tool_use"` with no
      // tool call to dispatch and the run stalls forever -- which is
      // exactly what happened to every tool-calling turn on execute_node
      // (no-tool capabilities never hit it, since they have no event that
      // must precede the result).
      let delivery: Promise<void> = Promise.resolve();
      const enqueue = (send: () => Promise<void>) => {
        delivery = delivery.then(send).catch(() => {});
        return delivery;
      };
      this.executionAnswerer
        .execute(
          data.input,
          input.customProvider,
          (event) => {
            void enqueue(() => this.engine.hostExecuteEvent(sid, data.call_id, event));
          },
          controller.signal,
        )
        .then(
          (result) => enqueue(() => this.engine.hostExecuteResult(sid, data.call_id, { ok: true, result })),
          (error: unknown) =>
            enqueue(() => this.engine.hostExecuteResult(sid, data.call_id, { ok: false, error: toExecutionError(error) })),
        )
        .catch(() => {});
    };

    const handleAgentEvent = (envelope: AgentEventEnvelope) => {
      observe(() => executionObservability.ingest(runId, envelope));
      const event = envelope.event as AgentEvent;
      if (settled) return;
      // Child terminal events belong to the child; they must not settle the
      // parent's task or count as its final response. They remain in the trace.
      if (envelope.parent_agent_id && ("Completed" in event || "Failed" in event || "AssistantTextDelta" in event)) return;
      if (!envelope.parent_agent_id) incompleteAgentRun?.observe(event);

      if ("AssistantTextDelta" in event) {
        transcript.push(event.AssistantTextDelta.message_id, event.AssistantTextDelta.delta);
        onEvent({ kind: "token", content: event.AssistantTextDelta.delta, ...(capability === "agent_chat" ? { messageId: event.AssistantTextDelta.message_id } : {}) } as CapabilityEvent<K>);
        return;
      }
      if ("ReasoningDelta" in event) {
        // Already captured by observability. Raw model reasoning is not a
        // user-facing progress update and must never enter saved chat history.
        return;
      }
      if ("UsageUpdated" in event) {
        const usage = mapUsage(event.UsageUpdated.usage);
        observe(() => executionObservability.recordUsage(runId, usage));
        onEvent({ kind: "usage", usage } as CapabilityEvent<K>);
        for (const listener of this.usageListeners) listener(runId, usage);
        recordUsage(usage);
        return;
      }
      if ("ToolCallRequested" in event) {
        const call = event.ToolCallRequested.call;
        const workspaceRoot = typeof input.workspaceRoot === "string" ? input.workspaceRoot : "";
        const paths = changedPathsFromTool(call.name, call.arguments, workspaceRoot);
        if (paths.length > 0) pendingFileChanges.set(call.id, paths);
        let detail = "";
        if (call.arguments && typeof call.arguments === "object") {
          const args = call.arguments as Record<string, unknown>;
          const cmd = args.command ?? args.cmd ?? args.program;
          const path = args.path ?? args.filename ?? args.file_path;
          if (typeof cmd === "string" && cmd.trim()) {
            detail = `: ${cmd.trim().slice(0, 60)}`;
          } else if (typeof path === "string" && path.trim()) {
            detail = `: ${path.trim().slice(0, 60)}`;
          }
        }
        onEvent({ kind: "log", message: `Calling ${call.name}${detail}...` } as CapabilityEvent<K>);
        return;
      }
      if ("ToolCallStarted" in event) {
        return;
      }
      if ("ToolCallCompleted" in event) {
        const res = event.ToolCallCompleted.result;
        const paths = pendingFileChanges.get(event.ToolCallCompleted.call_id) ?? [];
        pendingFileChanges.delete(event.ToolCallCompleted.call_id);
        if (!res.has_error && paths.length > 0) {
          const modifiedFiles = (runContext.scratch.modifiedFiles ??= new Set<string>()) as Set<string>;
          paths.forEach((path) => modifiedFiles.add(path));
          onEvent({ kind: "files_changed", paths } as CapabilityEvent<K>);
        }
        const preview = res.output_preview ? res.output_preview.trim().slice(0, 80) : "";
        const msg = res.has_error
          ? `Tool call failed${preview ? `: ${preview}` : "."}`
          : "Tool call completed.";
        onEvent({ kind: "log", message: msg } as CapabilityEvent<K>);
        return;
      }
      if ("PermissionRequested" in event) {
        handlePermissionRequested(event.PermissionRequested.request);
        return;
      }
      if ("Failed" in event) {
        if (event.Failed.error.code === "OUTPUT_LIMIT_REACHED" && incompleteAgentRun) {
          incompleteAgentRun.outputLimitReached();
          handleCompletedSuccess();
          return;
        }
        settle({ status: "failed", error: { code: event.Failed.error.code, message: event.Failed.error.message } });
        return;
      }
      if ("Completed" in event) {
        const outcome = event.Completed.outcome;
        if (outcome === "Success") {
          handleCompletedSuccess();
        } else if (outcome === "Cancelled") {
          settle({ status: "cancelled" });
        } else {
          settle({ status: "failed", error: { code: "CORE_RUN_FAILED", message: "The run failed." } });
        }
        return;
      }
      // StateChanged, RunStarted, BackendRequestStarted,
      // AssistantMessageStarted, ReasoningDelta, AssistantMessageCompleted,
      // ChildAgentSpawned, ChildAgentCompleted: no capability event to
      // surface for these yet -- no-op rather than a default branch that
      // would silently swallow a genuinely new variant (every arm above is
      // exhaustive over what Milestone B's inline_chat definition can ever
      // actually receive).
    };

    const handleBridgeEvent = (bridgeEvent: BridgeEvent) => {
      if (settled) return;
      switch (bridgeEvent.kind) {
        case "event":
          handleAgentEvent(bridgeEvent.data);
          return;
        case "gap":
          onEvent({
            kind: "log",
            message: `Dropped ${bridgeEvent.data.dropped} event(s) after a slow consumer.`,
          } as CapabilityEvent<K>);
          return;
        case "host_tool_call":
          handleHostToolCall(bridgeEvent.data);
          return;
        case "host_execute_call":
          handleHostExecuteCall(bridgeEvent.data);
          return;
        case "closed":
          settle({ status: "failed", error: { code: "CORE_SESSION_CLOSED", message: bridgeEvent.data.reason } });
          return;
      }
    };

    void (async () => {
      try {
        // Already validated non-null above -- TS's narrowing doesn't carry
        // this far into the closure captured by this async IIFE.
        const recipe = definition.recipe!(input);
        observe(() => trajectories.append(runId, "Session context", {
          systemPrompt: recipe.system_prompt, prompt: definition.promptText!(input),
          integration: recipe.integration, executionParams: recipe.execution_params,
          tools: recipe.host_tools, workspace: recipe.workspace,
          contextVisibility: "Host model requests are recorded separately. Managed CLI internal prompts, compaction and hidden reasoning are not exposed by the CLI.",
        }));
        const id = await this.engine.createSession(recipe);
        if (settled) {
          // cancel() ran while createSession() was still in flight -- this
          // run never got far enough for settle()'s own cleanup (sessionId
          // was still unset) to close it.
          void this.engine.closeSession(id).catch(() => {});
          return;
        }
        sessionId = id;
        observe(() => executionObservability.bindSession(runId, id));
        await this.engine.subscribe(id, handleBridgeEvent);
        resolveStarted();
        await this.engine.mutate(id, { type: "prompt", payload: { text: definition.promptText!(input), attachments: [] } });
      } catch (error: unknown) {
        const message = errorMessage(error);
        rejectStarted(new Error(message));
        settle({ status: "failed", error: { code: "CORE_SESSION_FAILED", message } });
      }
    })();

    return {
      runId,
      started,
      done,
      cancel: () => {
        if (settled) return;
        controller.abort();
        if (sessionId) void this.engine.mutate(sessionId, { type: "cancel" }).catch(() => {});
        settle({ status: "cancelled" });
      },
    };
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
      resolveDone(outcome);
    };

    const runSession = (session: {
      recipe: SessionRecipe;
      promptText: string;
      hostTools?: Record<string, HostToolHandler>;
      onToken?: (content: string) => void;
      onLog?: (message: string) => void;
      onUsage?: (usage: TokenUsage) => void;
    }): Promise<Transcript> =>
      this.runSingleShotSession({
        recipe: session.recipe,
        promptText: session.promptText,
        hostTools: session.hostTools ?? {},
        host,
        customProvider: input.customProvider,
        onToken: session.onToken,
        onLog: session.onLog,
        onUsage: session.onUsage,
        signal: controller.signal,
        ideRunId: runId,
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
   * method rather than unifying the two rather than risk destabilizing
   * the already-proven single-session path for a need nothing has yet.
   */
  private runSingleShotSession(options: {
    recipe: SessionRecipe;
    promptText: string;
    hostTools: Record<string, HostToolHandler>;
    host: RunHost;
    customProvider: unknown;
    onToken?: (content: string) => void;
    onLog?: (message: string) => void;
    onUsage?: (usage: TokenUsage) => void;
    signal: AbortSignal;
    ideRunId: string;
  }): Promise<Transcript> {
    const { recipe, promptText, hostTools, host, customProvider, onToken, onLog, onUsage, signal, ideRunId } = options;
    const transcript = createTranscript();
    let sessionId: string | undefined;
    let settled = false;

    return new Promise<Transcript>((resolve, reject) => {
      const finish = (fn: () => void) => {
        if (settled) return;
        settled = true;
        signal.removeEventListener("abort", abortListener);
        fn();
        if (sessionId) void this.engine.closeSession(sessionId).catch(() => {});
      };

      const abortListener = () => finish(() => reject(new DOMException("Aborted", "AbortError")));

      const handleHostToolCall = (data: { call_id: string; tool: string; input: unknown }) => {
        if (!sessionId) return;
        const sid = sessionId;
        if (data.tool === "workspace.read") {
          const path = String((data.input as { path?: unknown } | undefined)?.path ?? "");
          host
            .readFile(path, signal)
            .then((content) => this.engine.hostToolResult(sid, data.call_id, { ok: true, output: { content } }))
            .catch((error: unknown) => this.engine.hostToolResult(sid, data.call_id, { ok: false, error: errorMessage(error) }))
            .catch(() => {});
          return;
        }
        if (data.tool === "workspace.write") {
          const writeInput = data.input as { path?: unknown; content?: unknown } | undefined;
          const path = String(writeInput?.path ?? "");
          const content = String(writeInput?.content ?? "");
          host
            .writeFile(path, content, signal)
            .then(() => this.engine.hostToolResult(sid, data.call_id, { ok: true, output: {} }))
            .catch((error: unknown) => this.engine.hostToolResult(sid, data.call_id, { ok: false, error: errorMessage(error) }))
            .catch(() => {});
          return;
        }
        const handler = hostTools[data.tool];
        if (handler) {
          handler(data.input, signal)
            .then((outcome) => this.engine.hostToolResult(sid, data.call_id, outcome))
            .catch((error: unknown) => this.engine.hostToolResult(sid, data.call_id, { ok: false, error: errorMessage(error) }))
            .catch(() => {});
          return;
        }
        void this.engine
          .hostToolResult(sid, data.call_id, { ok: false, error: `CoreHarness: no handler for host tool "${data.tool}".` })
          .catch(() => {});
      };

      const handleHostExecuteCall = (data: { call_id: string; tool: string; input: ExecutionRequest }) => {
        if (!sessionId) return;
        const sid = sessionId;
        observe(() => trajectories.append(ideRunId, "Model request", data.input));
        let delivery: Promise<void> = Promise.resolve();
        const enqueue = (send: () => Promise<void>) => {
          delivery = delivery.then(send).catch(() => {});
          return delivery;
        };
        this.executionAnswerer
          .execute(
            data.input,
            customProvider,
            (event) => {
              void enqueue(() => this.engine.hostExecuteEvent(sid, data.call_id, event));
            },
            signal,
          )
          .then(
            (result) => enqueue(() => this.engine.hostExecuteResult(sid, data.call_id, { ok: true, result })),
            (error: unknown) =>
              enqueue(() => this.engine.hostExecuteResult(sid, data.call_id, { ok: false, error: toExecutionError(error) })),
          )
          .catch(() => {});
      };

      const handlePermissionRequested = (request: { id: string; tool_call: { id: string; name: string; arguments: unknown } }) => {
        const args = request.tool_call.arguments;
        void host
          .requestPermission(
            {
              requestId: request.id,
              sessionId: sessionId ?? "",
              command: {
                program: request.tool_call.name,
                args: Array.isArray(args) ? args.map(String) : [],
                cwd: "",
                timeoutMs: 0,
              },
              risk: "normal",
              sessionGrantScope: "exact_command",
              sessionGrantProgram: request.tool_call.name,
              description: `Allow "${request.tool_call.name}"?`,
            },
            signal,
          )
          .then((decision) => {
            if (settled || !sessionId) return;
            const mapped: PermissionDecision = decision === "deny" ? "Denied" : "Approved";
            return this.engine.mutate(sessionId, { type: "resolve_permission", payload: { id: request.id, decision: mapped } });
          })
          .catch(() => {});
      };

      const handleAgentEvent = (envelope: AgentEventEnvelope) => {
        observe(() => executionObservability.ingest(ideRunId, envelope));
        const event = envelope.event as AgentEvent;
        if ("AssistantTextDelta" in event) {
          transcript.push(event.AssistantTextDelta.message_id, event.AssistantTextDelta.delta);
          onToken?.(event.AssistantTextDelta.delta);
          return;
        }
        if ("UsageUpdated" in event) {
          const usage = mapUsage(event.UsageUpdated.usage);
          observe(() => executionObservability.recordUsage(ideRunId, usage));
          onUsage?.(usage);
          return;
        }
        if ("ToolCallRequested" in event) {
          onLog?.(`Calling ${event.ToolCallRequested.call.name}...`);
          return;
        }
        if ("ToolCallStarted" in event) {
          onLog?.(`Running tool call ${event.ToolCallStarted.call_id}...`);
          return;
        }
        if ("ToolCallCompleted" in event) {
          onLog?.(event.ToolCallCompleted.result.has_error ? "Tool call failed." : "Tool call completed.");
          return;
        }
        if ("PermissionRequested" in event) {
          handlePermissionRequested(event.PermissionRequested.request);
          return;
        }
        if ("Failed" in event) {
          finish(() => reject(new Error(event.Failed.error.message)));
          return;
        }
        if ("Completed" in event) {
          const outcome = event.Completed.outcome;
          if (outcome === "Success") {
            finish(() => resolve(transcript));
          } else if (outcome === "Cancelled") {
            finish(() => reject(new DOMException("Aborted", "AbortError")));
          } else {
            finish(() => reject(new Error("The run failed.")));
          }
          return;
        }
      };

      const handleBridgeEvent = (bridgeEvent: BridgeEvent) => {
        if (settled) return;
        switch (bridgeEvent.kind) {
          case "event":
            handleAgentEvent(bridgeEvent.data);
            return;
          case "gap":
            onLog?.(`Dropped ${bridgeEvent.data.dropped} event(s) after a slow consumer.`);
            return;
          case "host_tool_call":
            handleHostToolCall(bridgeEvent.data);
            return;
          case "host_execute_call":
            handleHostExecuteCall(bridgeEvent.data);
            return;
          case "closed":
            finish(() => reject(new Error(bridgeEvent.data.reason)));
            return;
        }
      };

      if (signal.aborted) {
        abortListener();
        return;
      }
      signal.addEventListener("abort", abortListener);

      void (async () => {
        try {
          observe(() => trajectories.append(ideRunId, "Session context", {
            systemPrompt: recipe.system_prompt, prompt: promptText, integration: recipe.integration,
            executionParams: recipe.execution_params, tools: recipe.host_tools, workspace: recipe.workspace,
            contextVisibility: "Managed CLI internal context is not exposed; host model requests are recorded separately.",
          }));
          const id = await this.engine.createSession(recipe);
          if (settled) {
            void this.engine.closeSession(id).catch(() => {});
            return;
          }
          sessionId = id;
          observe(() => executionObservability.bindSession(ideRunId, id));
          await this.engine.subscribe(id, handleBridgeEvent);
          await this.engine.mutate(id, { type: "prompt", payload: { text: promptText, attachments: [] } });
        } catch (error: unknown) {
          finish(() => reject(error instanceof Error ? error : new Error(errorMessage(error))));
        }
      })();
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
