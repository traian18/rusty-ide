import { describe, expect, it, vi } from "vitest";
import type { AgentEvent, AgentEventEnvelope, MutationCommand } from "@rusty/harness-sdk";

import type { InlineChatInput } from "../contract";
import type { HarnessControlPlane, UsageRecordSample } from "../contract/controlPlane";
import { createRecordingHost } from "../testing/recordingHost";
import { describeAgentHarnessContract, type ContractRun } from "../testing/contractTests";
import type { BridgeEvent, CoreEngine, HostExecuteOutcome, HostToolOutcome } from "./engine/CoreEngineClient";
import { CoreHarness, type CoreCapabilityDefinition, type ExecutionAnswerer, type HostToolHandler } from "./CoreHarness";
import type { ExecutionEvent, ExecutionRequest, ExecutionResult } from "./engine/ExecutionProtocol";
import { inlineChatDefinition } from "./definitions/inline_chat";
import type { SessionRecipe } from "./SessionRecipe";
import { executionObservability } from "../../observability/executionStore";

/**
 * Mirrors SidecarHarness.test.ts's own FakeTransport: an in-memory stand-in
 * for the Tauri IPC round trip (invoke + Channel), so this file proves
 * CoreHarness against the real CoreEngine contract with nothing but a fake
 * engine underneath -- no real Tauri runtime, no real rusty-core process.
 */
class FakeCoreEngine implements CoreEngine {
  recipes: SessionRecipe[] = [];
  mutations: Array<{ sessionId: string; command: MutationCommand }> = [];
  hostToolResults: Array<{ sessionId: string; callId: string; outcome: HostToolOutcome }> = [];
  hostExecuteEvents: Array<{ sessionId: string; callId: string; event: ExecutionEvent }> = [];
  hostExecuteResults: Array<{ sessionId: string; callId: string; outcome: HostExecuteOutcome }> = [];
  closedSessions: string[] = [];

  private subscribers = new Map<string, (event: BridgeEvent) => void>();
  private nextSessionId = 1;

  createSession(recipe: SessionRecipe): Promise<string> {
    this.recipes.push(recipe);
    return Promise.resolve(`session-${this.nextSessionId++}`);
  }

  subscribe(sessionId: string, onEvent: (event: BridgeEvent) => void): Promise<void> {
    this.subscribers.set(sessionId, onEvent);
    return Promise.resolve();
  }

  mutate(sessionId: string, command: MutationCommand): Promise<void> {
    this.mutations.push({ sessionId, command });
    return Promise.resolve();
  }

  hostToolResult(sessionId: string, callId: string, outcome: HostToolOutcome): Promise<void> {
    this.hostToolResults.push({ sessionId, callId, outcome });
    return Promise.resolve();
  }

  hostExecuteEvent(sessionId: string, callId: string, event: ExecutionEvent): Promise<void> {
    this.hostExecuteEvents.push({ sessionId, callId, event });
    return Promise.resolve();
  }

  hostExecuteResult(sessionId: string, callId: string, outcome: HostExecuteOutcome): Promise<void> {
    this.hostExecuteResults.push({ sessionId, callId, outcome });
    return Promise.resolve();
  }

  closeSession(sessionId: string): Promise<void> {
    this.closedSessions.push(sessionId);
    return Promise.resolve();
  }

  // --- test-only driver surface -------------------------------------------

  /** The most recently created session id -- every ContractRun in this file
   * creates exactly one. */
  lastSessionId(): string {
    return `session-${this.nextSessionId - 1}`;
  }

  emit(sessionId: string, event: BridgeEvent): void {
    this.subscribers.get(sessionId)?.(event);
  }
}

/**
 * A scriptable `ExecutionAnswerer`: `execute()` records the call and returns
 * a promise this test controls directly (via `emitEvent`/`resolve`/`reject`
 * on the entry it returns), rather than settling on its own -- mirrors
 * `FakeCoreEngine`'s own "record + let the test drive it" shape.
 */
class FakeExecutionAnswerer implements ExecutionAnswerer {
  calls: Array<{ request: ExecutionRequest; customProvider: unknown; signal: AbortSignal }> = [];
  private onEvents: Array<(event: ExecutionEvent) => void> = [];

  execute(
    request: ExecutionRequest,
    customProvider: unknown,
    onEvent: (event: ExecutionEvent) => void,
    signal: AbortSignal,
  ): Promise<ExecutionResult> {
    this.calls.push({ request, customProvider, signal });
    this.onEvents.push(onEvent);
    return new Promise((resolve, reject) => {
      this.resolvers.push({ resolve, reject });
    });
  }

  private resolvers: Array<{ resolve: (result: ExecutionResult) => void; reject: (error: unknown) => void }> = [];

  emitEvent(index: number, event: ExecutionEvent): void {
    this.onEvents[index]?.(event);
  }

  resolveCall(index: number, result: ExecutionResult): void {
    this.resolvers[index]?.resolve(result);
  }

  rejectCall(index: number, error: unknown): void {
    this.resolvers[index]?.reject(error);
  }
}

function fakeControlPlane(): HarnessControlPlane & { recorded: UsageRecordSample[] } {
  const recorded: UsageRecordSample[] = [];
  return {
    recorded,
    recordUsage: async (sample: UsageRecordSample) => {
      recorded.push(sample);
    },
  } as unknown as HarnessControlPlane & { recorded: UsageRecordSample[] };
}

/** Drains every queued microtask (the host-execute delivery chain is
 * several promise hops deep, so a single `await Promise.resolve()` isn't
 * enough to observe its effects). */
const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

let nextEventId = 1;
function envelope(event: AgentEvent): AgentEventEnvelope {
  const id = nextEventId++;
  return {
    event_id: `evt-${id}`,
    session_id: "session-under-test",
    agent_id: "agent-1",
    parent_agent_id: null,
    run_id: "run-1",
    agent_sequence: id,
    session_sequence: id,
    timestamp: new Date().toISOString(),
    visibility: "User",
    event,
  };
}

const INPUT: InlineChatInput = {
  sessionId: "editor-1",
  message: "What does this do?",
  model: "claude-opus-4-20250514",
  workspaceRoot: "/ws",
  customProvider: {
    id: "p1",
    name: "Anthropic",
    baseUrl: "https://api.anthropic.com",
    apiKey: "sk-test",
    apiType: "anthropic-messages",
    models: [],
  },
  history: [],
  context: {
    filePath: "/ws/a.ts",
    language: "typescript",
    fileContent: "",
    selection: { text: "", startLine: 0, startColumn: 0, endLine: 0, endColumn: 0 },
  },
};

function startRun(): ContractRun & {
  engine: FakeCoreEngine;
  controlPlane: ReturnType<typeof fakeControlPlane>;
  executionAnswerer: FakeExecutionAnswerer;
} {
  const engine = new FakeCoreEngine();
  const controlPlane = fakeControlPlane();
  const executionAnswerer = new FakeExecutionAnswerer();
  const harness = new CoreHarness({
    engine,
    controlPlane,
    executionAnswerer,
    definitions: { inline_chat: inlineChatDefinition },
  });
  const { host, calls } = createRecordingHost();
  const events: ContractRun["events"] = [];

  const handle = harness.run("inline_chat", { ...INPUT }, host, (event) => events.push(event));

  let messageCounter = 0;
  const emitAssistantText = (content: string) => {
    messageCounter += 1;
    engine.emit(engine.lastSessionId(), {
      kind: "event",
      data: envelope({ AssistantTextDelta: { message_id: `m${messageCounter}`, delta: content } }),
    });
  };

  return {
    harness,
    handle,
    events,
    hostCalls: calls,
    engine,
    controlPlane,
    executionAnswerer,
    driver: {
      // resolveStarted() only fires once createSession + subscribe have
      // both resolved -- awaiting `started` itself is the correct "has the
      // fake engine's subscriber been captured yet" signal for every other
      // driver method below.
      acceptStart: () => handle.started,
      requestRead: (path) =>
        engine.emit(engine.lastSessionId(), {
          kind: "host_tool_call",
          data: { call_id: "call-read", tool: "workspace.read", input: { path } },
        }),
      requestWrite: (path, content) =>
        engine.emit(engine.lastSessionId(), {
          kind: "host_tool_call",
          data: { call_id: "call-write", tool: "workspace.write", input: { path, content } },
        }),
      requestPermission: () =>
        engine.emit(engine.lastSessionId(), {
          kind: "event",
          data: envelope({
            PermissionRequested: { request: { id: "perm-1", tool_call: { id: "call-1", name: "shell.exec", arguments: {} }, agent_id: "agent-1" } },
          }),
        }),
      emitToken: (content) => emitAssistantText(content),
      finishWithResult: (response) => {
        emitAssistantText(response);
        engine.emit(engine.lastSessionId(), { kind: "event", data: envelope({ Completed: { outcome: "Success" } }) });
      },
      finishWithFailure: (message) =>
        engine.emit(engine.lastSessionId(), {
          kind: "event",
          data: envelope({ Failed: { error: { code: "TEST_FAILURE", message } } }),
        }),
    },
  };
}

describeAgentHarnessContract({ name: "CoreHarness (inline_chat)", start: startRun });

describe("CoreHarness-specific behavior", () => {
  it("keeps provider execution running when observability fails", async () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    const observer = vi.spyOn(executionObservability, "startRun").mockImplementationOnce(() => {
      throw new Error("local cache unavailable");
    });
    try {
      const run = startRun();
      await run.driver.acceptStart();
      run.driver.finishWithResult("still running");
      await expect(run.handle.done).resolves.toMatchObject({ status: "completed" });
      expect(warning).toHaveBeenCalledWith(
        "Execution observability failed without affecting the run:",
        expect.any(Error),
      );
    } finally {
      observer.mockRestore();
      warning.mockRestore();
    }
  });

  it("supports() is false when no definition is registered for the capability", () => {
    const harness = new CoreHarness({
      engine: new FakeCoreEngine(),
      controlPlane: fakeControlPlane(),
      executionAnswerer: new FakeExecutionAnswerer(),
      definitions: {},
    });
    expect(harness.supports("inline_chat", { ...INPUT })).toBe(false);
  });

  it("run() throws synchronously for a definition that provides neither orchestrate() nor recipe()/promptText()", () => {
    const definition: CoreCapabilityDefinition<"inline_chat"> = {
      ...inlineChatDefinition,
      recipe: undefined,
      promptText: undefined,
      orchestrate: undefined,
    };
    const harness = new CoreHarness({
      engine: new FakeCoreEngine(),
      controlPlane: fakeControlPlane(),
      executionAnswerer: new FakeExecutionAnswerer(),
      definitions: { inline_chat: definition },
    });
    const { host } = createRecordingHost();
    expect(() => harness.run("inline_chat", { ...INPUT }, host, () => {})).toThrow(
      /provides neither orchestrate\(\) nor recipe\(\)\/promptText\(\)/,
    );
  });

  it("supports() delegates to the definition's own supports()", () => {
    const definition: CoreCapabilityDefinition<"inline_chat"> = { ...inlineChatDefinition, supports: () => false };
    const harness = new CoreHarness({
      engine: new FakeCoreEngine(),
      controlPlane: fakeControlPlane(),
      executionAnswerer: new FakeExecutionAnswerer(),
      definitions: { inline_chat: definition },
    });
    expect(harness.supports("inline_chat", { ...INPUT })).toBe(false);
  });

  it("creates the session from the definition's recipe, subscribes, then sends the prompt", async () => {
    const { engine, driver } = startRun();
    await driver.acceptStart();
    expect(engine.recipes).toHaveLength(1);
    expect(engine.recipes[0].integration).toBe("host");
    expect(engine.mutations).toContainEqual({
      sessionId: "session-1",
      command: { type: "prompt", payload: { text: "What does this do?", attachments: [] } },
    });
  });

  it("cancel() sends a cancel mutation once the session exists", async () => {
    const { handle, engine, driver } = startRun();
    await driver.acceptStart();
    handle.cancel();
    await handle.done;
    expect(engine.mutations).toContainEqual({ sessionId: "session-1", command: { type: "cancel" } });
  });

  it("closes the session once the run settles", async () => {
    const { driver, engine } = startRun();
    await driver.acceptStart();
    await driver.finishWithResult("done");
    expect(engine.closedSessions).toEqual(["session-1"]);
  });

  it("answers a workspace.read host_tool_call from RunHost and reports the content back", async () => {
    const { driver, engine } = startRun();
    await driver.acceptStart();
    await driver.requestRead("/ws/a.ts");
    await Promise.resolve();
    await Promise.resolve();
    expect(engine.hostToolResults).toContainEqual({
      sessionId: "session-1",
      callId: "call-read",
      outcome: { ok: true, output: { content: "" } },
    });
  });

  it("answers a workspace.write host_tool_call from RunHost", async () => {
    const { driver, engine } = startRun();
    await driver.acceptStart();
    await driver.requestWrite("/ws/a.ts", "new content");
    await Promise.resolve();
    await Promise.resolve();
    expect(engine.hostToolResults).toContainEqual({
      sessionId: "session-1",
      callId: "call-write",
      outcome: { ok: true, output: {} },
    });
  });

  it("fails an unrecognized host tool rather than leaving it unanswered", async () => {
    const { engine, driver } = startRun();
    await driver.acceptStart();
    engine.emit(engine.lastSessionId(), {
      kind: "host_tool_call",
      data: { call_id: "call-x", tool: "mystery.tool", input: {} },
    });
    await Promise.resolve();
    expect(engine.hostToolResults).toContainEqual({
      sessionId: "session-1",
      callId: "call-x",
      outcome: { ok: false, error: 'CoreHarness: no handler for host tool "mystery.tool".' },
    });
  });

  it("dispatches a non-workspace host_tool_call to the definition's own hostTools handler", async () => {
    const handler = vi.fn().mockResolvedValue({ ok: true, output: "42" });
    const definition: CoreCapabilityDefinition<"inline_chat"> = {
      ...inlineChatDefinition,
      hostTools: () => ({ "my.tool": handler }),
    };
    const engine = new FakeCoreEngine();
    const harness = new CoreHarness({
      engine,
      controlPlane: fakeControlPlane(),
      executionAnswerer: new FakeExecutionAnswerer(),
      definitions: { inline_chat: definition },
    });
    const { host } = createRecordingHost();
    const handle = harness.run("inline_chat", { ...INPUT }, host, () => {});
    await handle.started;
    engine.emit(engine.lastSessionId(), {
      kind: "host_tool_call",
      data: { call_id: "call-1", tool: "my.tool", input: { x: 1 } },
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(handler).toHaveBeenCalledWith({ x: 1 }, expect.any(AbortSignal));
    expect(engine.hostToolResults).toContainEqual({
      sessionId: "session-1",
      callId: "call-1",
      outcome: { ok: true, output: "42" },
    });
  });

  it("reports a hostTools handler's rejection back as a failed host_tool_call outcome", async () => {
    const definition: CoreCapabilityDefinition<"inline_chat"> = {
      ...inlineChatDefinition,
      hostTools: () => ({ "my.tool": () => Promise.reject(new Error("boom")) }),
    };
    const engine = new FakeCoreEngine();
    const harness = new CoreHarness({
      engine,
      controlPlane: fakeControlPlane(),
      executionAnswerer: new FakeExecutionAnswerer(),
      definitions: { inline_chat: definition },
    });
    const { host } = createRecordingHost();
    const handle = harness.run("inline_chat", { ...INPUT }, host, () => {});
    await handle.started;
    engine.emit(engine.lastSessionId(), {
      kind: "host_tool_call",
      data: { call_id: "call-1", tool: "my.tool", input: {} },
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(engine.hostToolResults).toContainEqual({
      sessionId: "session-1",
      callId: "call-1",
      outcome: { ok: false, error: "boom" },
    });
  });

  it("calls hostTools() once per run, not once per host_tool_call, so a handler's closed-over state accumulates across calls", async () => {
    const hostToolsFactory = vi.fn((_input: unknown, _host: unknown, ctx: { scratch: Record<string, unknown> }) => {
      const seen = (ctx.scratch.seen ??= []) as string[];
      const recordPath: HostToolHandler = async (args) => {
        seen.push(String((args as { path?: unknown } | undefined)?.path ?? ""));
        return { ok: true, output: seen.length };
      };
      return { "record.path": recordPath };
    });
    const definition: CoreCapabilityDefinition<"inline_chat"> = { ...inlineChatDefinition, hostTools: hostToolsFactory };
    const engine = new FakeCoreEngine();
    const harness = new CoreHarness({
      engine,
      controlPlane: fakeControlPlane(),
      executionAnswerer: new FakeExecutionAnswerer(),
      definitions: { inline_chat: definition },
    });
    const { host } = createRecordingHost();
    const handle = harness.run("inline_chat", { ...INPUT }, host, () => {});
    await handle.started;
    engine.emit(engine.lastSessionId(), { kind: "host_tool_call", data: { call_id: "c1", tool: "record.path", input: { path: "a.ts" } } });
    await Promise.resolve();
    await Promise.resolve();
    engine.emit(engine.lastSessionId(), { kind: "host_tool_call", data: { call_id: "c2", tool: "record.path", input: { path: "b.ts" } } });
    await Promise.resolve();
    await Promise.resolve();
    expect(hostToolsFactory).toHaveBeenCalledTimes(1);
    expect(engine.hostToolResults).toContainEqual({ sessionId: "session-1", callId: "c1", outcome: { ok: true, output: 1 } });
    expect(engine.hostToolResults).toContainEqual({ sessionId: "session-1", callId: "c2", outcome: { ok: true, output: 2 } });
  });

  it("passes the run's own onEvent into hostTools(), so a tool handler can emit a CapabilityEvent directly (agent_chat's report_progress)", async () => {
    const definition: CoreCapabilityDefinition<"inline_chat"> = {
      ...inlineChatDefinition,
      hostTools: (_input, _host, _ctx, onEvent) => ({
        "report.progress": async () => {
          onEvent({ kind: "log", message: "Reading the router." });
          return { ok: true, output: "shown" };
        },
      }),
    };
    const engine = new FakeCoreEngine();
    const harness = new CoreHarness({
      engine,
      controlPlane: fakeControlPlane(),
      executionAnswerer: new FakeExecutionAnswerer(),
      definitions: { inline_chat: definition },
    });
    const { host } = createRecordingHost();
    const events: unknown[] = [];
    const handle = harness.run("inline_chat", { ...INPUT }, host, (event) => events.push(event));
    await handle.started;
    engine.emit(engine.lastSessionId(), {
      kind: "host_tool_call",
      data: { call_id: "c1", tool: "report.progress", input: {} },
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(events).toContainEqual({ kind: "log", message: "Reading the router." });
    expect(engine.hostToolResults).toContainEqual({
      sessionId: "session-1",
      callId: "c1",
      outcome: { ok: true, output: "shown" },
    });
  });

  it("forwards a host_execute_call to the injected ExecutionAnswerer with the request and the run's customProvider", async () => {
    const { engine, driver, executionAnswerer } = startRun();
    await driver.acceptStart();
    const request: ExecutionRequest = {
      request_id: "req-1",
      run_id: "run-1",
      system_prompt: "You are a test.",
      messages: [],
      tools: [],
      extended_thinking: false,
      params: {},
    };
    engine.emit(engine.lastSessionId(), {
      kind: "host_execute_call",
      data: { call_id: "call-exec", tool: "backend.execute", input: request },
    });
    await Promise.resolve();

    expect(executionAnswerer.calls).toHaveLength(1);
    expect(executionAnswerer.calls[0].request).toEqual(request);
    expect(executionAnswerer.calls[0].customProvider).toEqual(INPUT.customProvider);
  });

  it("streams the answerer's events back via hostExecuteEvent, then the terminal result via hostExecuteResult", async () => {
    const { engine, driver, executionAnswerer } = startRun();
    await driver.acceptStart();
    engine.emit(engine.lastSessionId(), {
      kind: "host_execute_call",
      data: {
        call_id: "call-exec",
        tool: "backend.execute",
        input: { request_id: "req-1", run_id: "run-1", system_prompt: "", messages: [], tools: [], extended_thinking: false, params: {} },
      },
    });
    await flush();

    const delta: ExecutionEvent = { TextDelta: { request_id: "req-1", delta: "hi" } };
    executionAnswerer.emitEvent(0, delta);
    await flush();
    expect(engine.hostExecuteEvents).toContainEqual({ sessionId: "session-1", callId: "call-exec", event: delta });

    const result: ExecutionResult = {
      request_id: "req-1",
      usage: { input_tokens: null, output_tokens: null, cache_read_tokens: null, cache_write_tokens: null, reasoning_tokens: null, total_tokens: null },
      cost: { amount_usd: null, source: null },
      finish_reason: "end_turn",
    };
    executionAnswerer.resolveCall(0, result);
    await flush();
    expect(engine.hostExecuteResults).toContainEqual({
      sessionId: "session-1",
      callId: "call-exec",
      outcome: { ok: true, result },
    });
  });

  it("delivers the terminal result only after every preceding event invoke has resolved, even when an event invoke is slow", async () => {
    // Rust's HostBridge::finish_stream removes the pending stream; a
    // later push_event for the same call_id is then silently dropped. So
    // a ToolCallRequested event whose invoke is still in flight when the
    // result invoke lands would be lost -- the exact stall every
    // tool-calling execute_node turn hit live. Slow the event invoke down
    // and prove the result still waits for it.
    const engine = new FakeCoreEngine();
    let releaseEvent!: () => void;
    const eventGate = new Promise<void>((resolve) => (releaseEvent = resolve));
    const order: string[] = [];
    engine.hostExecuteEvent = async (sessionId, callId, event) => {
      await eventGate;
      order.push("event");
      engine.hostExecuteEvents.push({ sessionId, callId, event });
    };
    engine.hostExecuteResult = async (sessionId, callId, outcome) => {
      order.push("result");
      engine.hostExecuteResults.push({ sessionId, callId, outcome });
    };
    const executionAnswerer = new FakeExecutionAnswerer();
    const harness = new CoreHarness({
      engine,
      controlPlane: fakeControlPlane(),
      executionAnswerer,
      definitions: { inline_chat: inlineChatDefinition },
    });
    const { host } = createRecordingHost();
    const handle = harness.run("inline_chat", { ...INPUT }, host, () => {});
    await handle.started;
    engine.emit(engine.lastSessionId(), {
      kind: "host_execute_call",
      data: {
        call_id: "call-exec",
        tool: "backend.execute",
        input: { request_id: "req-1", run_id: "run-1", system_prompt: "", messages: [], tools: [], extended_thinking: false, params: {} },
      },
    });
    await flush();

    executionAnswerer.emitEvent(0, {
      ToolCallRequested: { request_id: "req-1", call: { id: "tc-1", name: "read_file", arguments: { path: "a.ts" } } },
    });
    executionAnswerer.resolveCall(0, {
      request_id: "req-1",
      usage: { input_tokens: null, output_tokens: null, cache_read_tokens: null, cache_write_tokens: null, reasoning_tokens: null, total_tokens: null },
      cost: { amount_usd: null, source: null },
      finish_reason: "tool_use",
    });
    await flush();
    // The result must NOT have been delivered while the event is still gated.
    expect(order).toEqual([]);

    releaseEvent();
    await flush();
    expect(order).toEqual(["event", "result"]);
  });

  it("reports the answerer's rejection back as a mapped ExecutionError via hostExecuteResult", async () => {
    const { engine, driver, executionAnswerer } = startRun();
    await driver.acceptStart();
    engine.emit(engine.lastSessionId(), {
      kind: "host_execute_call",
      data: {
        call_id: "call-exec",
        tool: "backend.execute",
        input: { request_id: "req-1", run_id: "run-1", system_prompt: "", messages: [], tools: [], extended_thinking: false, params: {} },
      },
    });
    await Promise.resolve();

    executionAnswerer.rejectCall(0, new Error("sidecar unreachable"));
    await Promise.resolve();
    await Promise.resolve();
    expect(engine.hostExecuteResults).toContainEqual({
      sessionId: "session-1",
      callId: "call-exec",
      outcome: { ok: false, error: { BackendError: { message: "sidecar unreachable", code: "HOST_EXECUTE_ANSWERER_FAILED" } } },
    });
  });

  it("passes an already-well-formed ExecutionError rejection through unchanged, not re-wrapped or stringified", async () => {
    const { engine, driver, executionAnswerer } = startRun();
    await driver.acceptStart();
    engine.emit(engine.lastSessionId(), {
      kind: "host_execute_call",
      data: {
        call_id: "call-exec",
        tool: "backend.execute",
        input: { request_id: "req-1", run_id: "run-1", system_prompt: "", messages: [], tools: [], extended_thinking: false, params: {} },
      },
    });
    await Promise.resolve();

    // Mirrors what SidecarExecutionAnswerer actually rejects with when the
    // sidecar reports a real provider error (e.g. a model restriction) --
    // a plain object shaped like ExecutionError, not an Error instance.
    // Before the isExecutionError() guard, this got re-wrapped via
    // errorMessage()'s String(error) fallback into the useless
    // "[object Object]", discarding the real message entirely.
    executionAnswerer.rejectCall(0, {
      BackendError: { message: "400: OpenCode's free tier can only be used in OpenCode", code: "BACKEND_ERROR" },
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(engine.hostExecuteResults).toContainEqual({
      sessionId: "session-1",
      callId: "call-exec",
      outcome: {
        ok: false,
        error: { BackendError: { message: "400: OpenCode's free tier can only be used in OpenCode", code: "BACKEND_ERROR" } },
      },
    });
  });

  it("maps UsageUpdated into a usage event, notifies subscribeUsage, and calls controlPlane.recordUsage", async () => {
    const { harness, engine, driver, events, handle } = startRun();
    const seen: Array<[string, number]> = [];
    const unsubscribe = harness.subscribeUsage((runId, usage) => seen.push([runId, usage.totalTokens ?? -1]));

    await driver.acceptStart();
    engine.emit(engine.lastSessionId(), {
      kind: "event",
      data: envelope({ UsageUpdated: { usage: { agent_id: "agent-1", timestamp: new Date().toISOString(), metrics: { total_tokens: 42 } } as never } }),
    });
    await Promise.resolve();

    expect(events).toContainEqual({ kind: "usage", usage: { totalTokens: 42 } });
    expect(seen).toEqual([[handle.runId, 42]]);
    unsubscribe();
  });

  it("recordUsage sends the totals under a zeroed per-field breakdown, since core reports a total only", async () => {
    const { controlPlane, engine, driver } = startRun();
    await driver.acceptStart();
    engine.emit(engine.lastSessionId(), {
      kind: "event",
      data: envelope({ UsageUpdated: { usage: { agent_id: "agent-1", timestamp: new Date().toISOString(), metrics: { total_tokens: 7 } } as never } }),
    });
    await Promise.resolve();

    expect(controlPlane.recorded).toEqual([
      {
        workspaceRoot: "/ws",
        surface: "inline_chat",
        runId: expect.any(String),
        provider: undefined,
        model: "claude-opus-4-20250514",
        usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 7 },
      },
    ]);
  });

  it("a BridgeEvent::Gap is surfaced as a log event, not silently dropped", async () => {
    const { engine, driver, events } = startRun();
    await driver.acceptStart();
    engine.emit(engine.lastSessionId(), { kind: "gap", data: { last_delivered_sequence: 3, dropped: 2 } });
    expect(events).toContainEqual({ kind: "log", message: "Dropped 2 event(s) after a slow consumer." });
  });

  it("a BridgeEvent::Closed settles the run as failed with the given reason", async () => {
    const { engine, driver, handle } = startRun();
    await driver.acceptStart();
    engine.emit(engine.lastSessionId(), { kind: "closed", data: { reason: "session closed" } });
    const outcome = await handle.done;
    expect(outcome).toEqual({ status: "failed", error: { code: "CORE_SESSION_CLOSED", message: "session closed" } });
  });

  it("run() throws when no definition is registered for the capability", () => {
    const harness = new CoreHarness({
      engine: new FakeCoreEngine(),
      controlPlane: fakeControlPlane(),
      executionAnswerer: new FakeExecutionAnswerer(),
      definitions: {},
    });
    const { host } = createRecordingHost();
    expect(() => harness.run("inline_chat", { ...INPUT }, host, vi.fn())).toThrow(/no definition registered/);
  });

  it("a recipe() that throws (unsupported provider) settles the run as failed instead of hanging", async () => {
    const engine = new FakeCoreEngine();
    const definition: CoreCapabilityDefinition<"inline_chat"> = {
      ...inlineChatDefinition,
      recipe: () => {
        throw new Error("unsupported provider");
      },
    };
    const harness = new CoreHarness({
      engine,
      controlPlane: fakeControlPlane(),
      executionAnswerer: new FakeExecutionAnswerer(),
      definitions: { inline_chat: definition },
    });
    const { host } = createRecordingHost();
    const handle = harness.run("inline_chat", { ...INPUT }, host, vi.fn());

    await expect(handle.started).rejects.toThrow("unsupported provider");
    const outcome = await handle.done;
    expect(outcome).toEqual({ status: "failed", error: { code: "CORE_SESSION_FAILED", message: "unsupported provider" } });
    expect(engine.recipes).toEqual([]);
  });

  it("toResult() throwing settles the run as failed instead of leaving done hanging forever", async () => {
    const engine = new FakeCoreEngine();
    const definition: CoreCapabilityDefinition<"inline_chat"> = {
      ...inlineChatDefinition,
      toResult: () => {
        throw new Error("malformed response");
      },
    };
    const harness = new CoreHarness({
      engine,
      controlPlane: fakeControlPlane(),
      executionAnswerer: new FakeExecutionAnswerer(),
      definitions: { inline_chat: definition },
    });
    const { host } = createRecordingHost();
    const events: unknown[] = [];
    const handle = harness.run("inline_chat", { ...INPUT }, host, (event) => events.push(event));

    await handle.started;
    engine.emit(engine.lastSessionId(), { kind: "event", data: envelope({ Completed: { outcome: "Success" } }) });
    const outcome = await handle.done;
    expect(outcome).toEqual({ status: "failed", error: { code: "CORE_RESULT_FAILED", message: "malformed response" } });
  });

  it("onCompleted() returning done:false sends another prompt in the same session and waits for the next Completed", async () => {
    const engine = new FakeCoreEngine();
    const seenAttempts: number[] = [];
    const definition: CoreCapabilityDefinition<"inline_chat"> = {
      ...inlineChatDefinition,
      onCompleted: (transcript, _input, attempt) => {
        seenAttempts.push(attempt);
        if (attempt === 1) return { done: false, promptText: "please retry with stricter formatting" };
        return { done: true, result: { response: transcript.lastMessageText() } };
      },
    };
    const harness = new CoreHarness({
      engine,
      controlPlane: fakeControlPlane(),
      executionAnswerer: new FakeExecutionAnswerer(),
      definitions: { inline_chat: definition },
    });
    const { host } = createRecordingHost();
    const handle = harness.run("inline_chat", { ...INPUT }, host, vi.fn());

    await handle.started;
    engine.emit(engine.lastSessionId(), { kind: "event", data: envelope({ Completed: { outcome: "Success" } }) });
    await Promise.resolve();
    await Promise.resolve();

    expect(engine.mutations).toContainEqual({
      sessionId: "session-1",
      command: { type: "prompt", payload: { text: "please retry with stricter formatting", attachments: [] } },
    });
    engine.emit(engine.lastSessionId(), {
      kind: "event",
      data: envelope({ AssistantTextDelta: { message_id: "m-retry", delta: "the retried answer" } }),
    });
    engine.emit(engine.lastSessionId(), { kind: "event", data: envelope({ Completed: { outcome: "Success" } }) });

    const outcome = await handle.done;
    expect(outcome).toEqual({ status: "completed", result: { response: "the retried answer" } });
    expect(seenAttempts).toEqual([1, 2]);
  });

  it("onCompleted() that never returns done:true settles as failed once the defensive attempt ceiling is hit", async () => {
    const engine = new FakeCoreEngine();
    const definition: CoreCapabilityDefinition<"inline_chat"> = {
      ...inlineChatDefinition,
      onCompleted: () => ({ done: false, promptText: "try again" }),
    };
    const harness = new CoreHarness({
      engine,
      controlPlane: fakeControlPlane(),
      executionAnswerer: new FakeExecutionAnswerer(),
      definitions: { inline_chat: definition },
    });
    const { host } = createRecordingHost();
    const handle = harness.run("inline_chat", { ...INPUT }, host, vi.fn());
    await handle.started;

    for (let i = 0; i < 12; i++) {
      engine.emit(engine.lastSessionId(), { kind: "event", data: envelope({ Completed: { outcome: "Success" } }) });
      await Promise.resolve();
    }

    const outcome = await handle.done;
    expect(outcome).toEqual({
      status: "failed",
      error: { code: "CORE_RUN_DID_NOT_CONVERGE", message: "The run did not produce a final result." },
    });
  });
});

describe("CoreHarness orchestrate() -- multi-session capabilities", () => {
  function orchestrateHarness(
    orchestrate: NonNullable<CoreCapabilityDefinition<"inline_chat">["orchestrate"]>,
  ): { harness: CoreHarness; engine: FakeCoreEngine } {
    const definition: CoreCapabilityDefinition<"inline_chat"> = { ...inlineChatDefinition, orchestrate };
    const engine = new FakeCoreEngine();
    const harness = new CoreHarness({
      engine,
      controlPlane: fakeControlPlane(),
      executionAnswerer: new FakeExecutionAnswerer(),
      definitions: { inline_chat: definition },
    });
    return { harness, engine };
  }

  it("started resolves immediately -- there is no single session-created moment to gate on", async () => {
    const { harness } = orchestrateHarness(async () => ({ response: "done" }));
    const { host } = createRecordingHost();
    const handle = harness.run("inline_chat", { ...INPUT }, host, () => {});
    await expect(handle.started).resolves.toBeUndefined();
  });

  it("runSession() drives a real session to completion and resolves with its accumulated transcript", async () => {
    let capturedText: string | undefined;
    const { harness, engine } = orchestrateHarness(async ({ runSession }) => {
      const transcript = await runSession({
        recipe: { workspace: { root: "/ws" }, integration: "host" },
        promptText: "reconcile this file",
      });
      capturedText = transcript.lastMessageText();
      return { response: capturedText };
    });
    const { host } = createRecordingHost();
    const handle = harness.run("inline_chat", { ...INPUT }, host, () => {});
    await handle.started;
    // The session is created asynchronously inside runSession -- give its
    // own microtask queue a turn before the fake engine has a session to emit against.
    await Promise.resolve();
    await Promise.resolve();
    engine.emit(engine.lastSessionId(), { kind: "event", data: envelope({ AssistantTextDelta: { message_id: "m1", delta: "No conflicts." } }) });
    await Promise.resolve();
    engine.emit(engine.lastSessionId(), { kind: "event", data: envelope({ Completed: { outcome: "Success" } }) });
    const outcome = await handle.done;
    expect(capturedText).toBe("No conflicts.");
    expect(outcome).toEqual({ status: "completed", result: { response: "No conflicts." } });
    expect(engine.closedSessions).toEqual(["session-1"]);
    expect(engine.recipes[0]).toEqual({ workspace: { root: "/ws" }, integration: "host" });
    expect(engine.mutations).toContainEqual({
      sessionId: "session-1",
      command: { type: "prompt", payload: { text: "reconcile this file", attachments: [] } },
    });
  });

  it("calling runSession() twice creates two independent sessions, in sequence", async () => {
    const reports: string[] = [];
    const { harness, engine } = orchestrateHarness(async ({ runSession }) => {
      for (const file of ["a.ts", "b.ts"]) {
        const transcript = await runSession({ recipe: { workspace: { root: "/ws" }, integration: "host" }, promptText: `reconcile ${file}` });
        reports.push(transcript.lastMessageText());
      }
      return { response: reports.join(", ") };
    });
    const { host } = createRecordingHost();
    const handle = harness.run("inline_chat", { ...INPUT }, host, () => {});
    await handle.started;

    await Promise.resolve();
    await Promise.resolve();
    expect(engine.recipes).toHaveLength(1);
    engine.emit(engine.lastSessionId(), { kind: "event", data: envelope({ AssistantTextDelta: { message_id: "m1", delta: "A resolved." } }) });
    await Promise.resolve();
    engine.emit(engine.lastSessionId(), { kind: "event", data: envelope({ Completed: { outcome: "Success" } }) });

    await Promise.resolve();
    await Promise.resolve();
    expect(engine.recipes).toHaveLength(2);
    engine.emit(engine.lastSessionId(), { kind: "event", data: envelope({ AssistantTextDelta: { message_id: "m2", delta: "B resolved." } }) });
    await Promise.resolve();
    engine.emit(engine.lastSessionId(), { kind: "event", data: envelope({ Completed: { outcome: "Success" } }) });

    const outcome = await handle.done;
    expect(reports).toEqual(["A resolved.", "B resolved."]);
    expect(outcome).toEqual({ status: "completed", result: { response: "A resolved., B resolved." } });
    expect(engine.closedSessions).toEqual(["session-1", "session-2"]);
  });

  it("runSession() dispatches that session's own hostTools and forwards onToken/onLog/onUsage", async () => {
    const tokens: string[] = [];
    const logs: string[] = [];
    const usages: unknown[] = [];
    const { harness, engine } = orchestrateHarness(async ({ runSession }) => {
      const readFile = vi.fn().mockResolvedValue({ ok: true, output: "file content" });
      const transcript = await runSession({
        recipe: { workspace: { root: "/ws" }, integration: "host" },
        promptText: "go",
        hostTools: { read_file: readFile },
        onToken: (t) => tokens.push(t),
        onLog: (m) => logs.push(m),
        onUsage: (u) => usages.push(u),
      });
      return { response: transcript.lastMessageText() };
    });
    const { host } = createRecordingHost();
    const handle = harness.run("inline_chat", { ...INPUT }, host, () => {});
    await handle.started;
    await Promise.resolve();
    await Promise.resolve();

    engine.emit(engine.lastSessionId(), { kind: "host_tool_call", data: { call_id: "c1", tool: "read_file", input: { path: "a.ts" } } });
    await Promise.resolve();
    await Promise.resolve();
    expect(engine.hostToolResults).toContainEqual({
      sessionId: "session-1",
      callId: "c1",
      outcome: { ok: true, output: "file content" },
    });

    engine.emit(engine.lastSessionId(), { kind: "event", data: envelope({ AssistantTextDelta: { message_id: "m1", delta: "hi" } }) });
    engine.emit(engine.lastSessionId(), {
      kind: "event",
      data: envelope({ UsageUpdated: { usage: { agent_id: "agent-1", timestamp: new Date().toISOString(), metrics: { total_tokens: 42 } } as never } }),
    });
    engine.emit(engine.lastSessionId(), { kind: "event", data: envelope({ ToolCallRequested: { call: { id: "tc-1", name: "read_file", arguments: {} } } }) });
    await Promise.resolve();
    engine.emit(engine.lastSessionId(), { kind: "event", data: envelope({ Completed: { outcome: "Success" } }) });
    await handle.done;

    expect(tokens).toEqual(["hi"]);
    expect(usages).toEqual([{ totalTokens: 42 }]);
    expect(logs).toContainEqual("Calling read_file...");
  });

  it("a session's Failed event rejects runSession(), and an orchestrate that doesn't catch it settles the run as failed", async () => {
    const { harness, engine } = orchestrateHarness(async ({ runSession }) => {
      const transcript = await runSession({ recipe: { workspace: { root: "/ws" }, integration: "host" }, promptText: "go" });
      return { response: transcript.lastMessageText() };
    });
    const { host } = createRecordingHost();
    const handle = harness.run("inline_chat", { ...INPUT }, host, () => {});
    await handle.started;
    await Promise.resolve();
    await Promise.resolve();
    engine.emit(engine.lastSessionId(), { kind: "event", data: envelope({ Failed: { error: { code: "PROVIDER_ERROR", message: "boom" } } }) });
    const outcome = await handle.done;
    expect(outcome).toEqual({
      status: "failed",
      error: { code: "CORE_ORCHESTRATION_FAILED", message: "boom" },
    });
    expect(engine.closedSessions).toEqual(["session-1"]);
  });

  it("an orchestrate that catches runSession()'s per-item failure and continues still reports the overall result", async () => {
    const { harness, engine } = orchestrateHarness(async ({ runSession }) => {
      const results: string[] = [];
      for (const file of ["a.ts", "b.ts"]) {
        try {
          const transcript = await runSession({ recipe: { workspace: { root: "/ws" }, integration: "host" }, promptText: file });
          results.push(transcript.lastMessageText());
        } catch (error) {
          results.push(`error: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
      return { response: results.join(" | ") };
    });
    const { host } = createRecordingHost();
    const handle = harness.run("inline_chat", { ...INPUT }, host, () => {});
    await handle.started;

    await Promise.resolve();
    await Promise.resolve();
    engine.emit(engine.lastSessionId(), { kind: "event", data: envelope({ Failed: { error: { code: "X", message: "bad file" } } }) });

    await Promise.resolve();
    await Promise.resolve();
    engine.emit(engine.lastSessionId(), { kind: "event", data: envelope({ AssistantTextDelta: { message_id: "m1", delta: "ok" } }) });
    await Promise.resolve();
    engine.emit(engine.lastSessionId(), { kind: "event", data: envelope({ Completed: { outcome: "Success" } }) });

    const outcome = await handle.done;
    expect(outcome).toEqual({ status: "completed", result: { response: "error: bad file | ok" } });
  });

  it("cancel() aborts an in-flight runSession() with an AbortError and settles the run as cancelled", async () => {
    let caughtName: string | undefined;
    const { harness, engine } = orchestrateHarness(async ({ runSession }) => {
      try {
        await runSession({ recipe: { workspace: { root: "/ws" }, integration: "host" }, promptText: "go" });
      } catch (error) {
        caughtName = error instanceof Error ? error.name : undefined;
        throw error;
      }
      return { response: "unreachable" };
    });
    const { host } = createRecordingHost();
    const handle = harness.run("inline_chat", { ...INPUT }, host, () => {});
    await handle.started;
    await Promise.resolve();
    await Promise.resolve();
    handle.cancel();
    const outcome = await handle.done;
    expect(outcome).toEqual({ status: "cancelled" });
    expect(caughtName).toBe("AbortError");
    expect(engine.closedSessions).toEqual(["session-1"]);
  });
});

describe("Agent task continuation", () => {
  it("recovers an output-limited announcement and retains message IDs through the continuation", async () => {
    const { engine, handle, emit, events } = setup(); await handle.started;
    emit({ AssistantTextDelta: { message_id: "status", delta: "Inspecting the projects." } });
    emit({ ToolCallCompleted: { call_id: "call", result: { has_error: false, output_preview: "source" } } });
    emit({ AssistantTextDelta: { message_id: "promise", delta: "I'll now provide the comprehensive architectural overview document." } });
    emit({ Failed: { error: { code: "OUTPUT_LIMIT_REACHED", message: "max_tokens" } } });
    expect(engine.closedSessions).toEqual([]);
    expect(engine.mutations.filter((m) => m.command.type === "prompt")).toHaveLength(2);
    emit({ AssistantTextDelta: { message_id: "answer", delta: "React UI communicates with the Rust runtime through Tauri." } });
    emit({ Completed: { outcome: "Success" } });
    expect(await handle.done).toMatchObject({ status: "completed", result: { response: "React UI communicates with the Rust runtime through Tauri." } });
    expect(events.filter((e: any) => e.kind === "token")).toEqual([
      { kind: "token", messageId: "status", content: "Inspecting the projects." },
      { kind: "token", messageId: "promise", content: "I'll now provide the comprehensive architectural overview document." },
      { kind: "token", messageId: "answer", content: "React UI communicates with the Rust runtime through Tauri." },
    ]);
  });
  it("reports repeated output exhaustion as incomplete instead of successful", async () => {
    const { engine, handle, emit } = setup(); await handle.started;
    for (let i = 0; i < 3; i++) {
      emit({ AssistantTextDelta: { message_id: `partial-${i}`, delta: "Some partial findings" } });
      emit({ Failed: { error: { code: "OUTPUT_LIMIT_REACHED", message: "max_tokens" } } });
    }
    expect(await handle.done).toMatchObject({ status: "failed", error: { code: "INCOMPLETE_AGENT_RUN" } });
    expect(engine.mutations.filter((m) => m.command.type === "prompt")).toHaveLength(3);
  });
  it("keeps raw reasoning out of user-facing chat events", async () => {
    const { handle, emit, events } = setup(); await handle.started;
    emit({ ReasoningDelta: { message_id: "thought", delta: "Internal planning text" } });
    expect(events).toEqual([]);
    emit({ AssistantTextDelta: { message_id: "final", delta: "Here are the findings." } });
    emit({ Completed: { outcome: "Success" } });
    expect(await handle.done).toMatchObject({ status: "completed", result: { response: "Here are the findings." } });
  });
  const agentInput = { tabId: "agent", message: "fix this", workspaceRoot: "/ws", model: "model", chatHistory: [], customProvider: INPUT.customProvider, skill: null, mcpServers: [], planOnly: false, vfsOnly: false, lspSettings: {} };
  function setup() {
    const engine = new FakeCoreEngine();
    const events: unknown[] = [];
    const definition: CoreCapabilityDefinition<"agent_chat"> = {
      capability: "agent_chat",
      recipe: () => ({ workspace: { root: "/ws" }, integration: "codex", system_prompt: "test instructions" }),
      promptText: () => "fix this",
      toResult: (transcript, _input, ctx) => ({
        response: transcript.lastMessageText(),
        modifiedFiles: [...((ctx.scratch.modifiedFiles as Set<string> | undefined) ?? [])],
        subagents: [],
      }),
      usageContext: () => ({ workspaceRoot: "/ws", model: "model" }),
    };
    const harness = new CoreHarness({ engine, controlPlane: fakeControlPlane(), executionAnswerer: new FakeExecutionAnswerer(), definitions: { agent_chat: definition } });
    const handle = harness.run("agent_chat", agentInput, createRecordingHost().host, (event) => events.push(event));
    const emit = (event: AgentEvent) => engine.emit(engine.lastSessionId(), { kind: "event", data: envelope(event) });
    return { engine, handle, emit, events };
  }
  it("continues the same session after an empty tool-ending turn, then returns the response", async () => {
    const { engine, handle, emit } = setup(); await handle.started;
    emit({ ToolCallCompleted: { call_id: "call", result: { has_error: true, output_preview: "no file" } } });
    emit({ Completed: { outcome: "Success" } });
    expect(engine.closedSessions).toEqual([]);
    expect(engine.mutations.filter((m) => m.command.type === "prompt")).toHaveLength(2);
    expect(engine.recipes).toHaveLength(1);
    emit({ AssistantTextDelta: { message_id: "final", delta: "Fixed and checked." } });
    emit({ Completed: { outcome: "Success" } });
    expect(await handle.done).toMatchObject({ status: "completed", result: { response: "Fixed and checked." } });
  });
  it("does not restart cancelled or backend-failed runs", async () => {
    for (const terminal of [{ Completed: { outcome: "Cancelled" } }, { Failed: { error: { code: "quota", message: "limit reached" } } }] as AgentEvent[]) {
      const { engine, handle, emit } = setup(); await handle.started;
      emit({ ToolCallCompleted: { call_id: "call", result: { has_error: true, output_preview: "error" } } });
      emit(terminal);
      expect((await handle.done).status).not.toBe("completed");
      expect(engine.mutations.filter((m) => m.command.type === "prompt")).toHaveLength(1);
    }
  });
  it("ignores child terminal events and bounds empty continuations", async () => {
    const { engine, handle, emit } = setup(); await handle.started;
    engine.emit(engine.lastSessionId(), { kind: "event", data: { ...envelope({ Completed: { outcome: "Success" } }), parent_agent_id: "parent" } });
    expect(engine.closedSessions).toEqual([]);
    emit({ ToolCallCompleted: { call_id: "call", result: { has_error: true, output_preview: "error" } } });
    for (let i = 0; i < 3; i++) emit({ Completed: { outcome: "Success" } });
    expect(await handle.done).toMatchObject({ status: "failed", error: { code: "INCOMPLETE_AGENT_RUN" } });
    expect(engine.mutations.filter((m) => m.command.type === "prompt")).toHaveLength(3);
  });
  it("reports managed-runtime file changes live and in the final result", async () => {
    const { handle, emit, events } = setup(); await handle.started;
    emit({ ToolCallRequested: { call: { id: "change", name: "file_change", arguments: {
      changes: [{ kind: "update", path: "src/App.tsx" }, { kind: "add", path: "src/new.ts" }],
    } } } });
    emit({ ToolCallCompleted: { call_id: "change", result: { has_error: false, output_preview: "applied" } } });
    expect(events).toContainEqual({ kind: "files_changed", paths: ["/ws/src/App.tsx", "/ws/src/new.ts"] });
    emit({ AssistantTextDelta: { message_id: "final", delta: "Done." } });
    emit({ Completed: { outcome: "Success" } });
    expect(await handle.done).toMatchObject({
      status: "completed",
      result: { modifiedFiles: ["/ws/src/App.tsx", "/ws/src/new.ts"] },
    });
  });
  it("does not report a failed managed-runtime edit as a modified file", async () => {
    const { handle, emit, events } = setup(); await handle.started;
    emit({ ToolCallRequested: { call: { id: "failed-change", name: "Write", arguments: { file_path: "src/App.tsx" } } } });
    emit({ ToolCallCompleted: { call_id: "failed-change", result: { has_error: true, output_preview: "permission denied" } } });
    expect(events).not.toContainEqual({ kind: "files_changed", paths: ["/ws/src/App.tsx"] });
    emit({ AssistantTextDelta: { message_id: "final", delta: "Blocked." } });
    emit({ Completed: { outcome: "Success" } });
    expect(await handle.done).toMatchObject({ status: "completed", result: { modifiedFiles: [] } });
  });
});
