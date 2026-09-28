import { describe, expect, it, vi } from "vitest";
import type { CustomProvider } from "../../../store/types";
import type { ExecutionAnswerer } from "../CoreHarness";
import type { BridgeEvent, CoreEngine } from "../engine/CoreEngineClient";
import type { ExecutionRequest, ExecutionResult } from "../engine/ExecutionProtocol";
import { RoutedSelectorModelInvoker, type SelectorModelRequest } from "./modelInvoker";

function scriptedEngine(events: unknown[]): CoreEngine {
  let listener: ((event: BridgeEvent) => void) | undefined;
  return {
    createSession: vi.fn(async () => "selector-session"),
    subscribe: vi.fn(async (_id, onEvent) => { listener = onEvent; }),
    mutate: vi.fn(async () => {
      for (const event of events) listener?.({ kind: "event", data: { event } as never });
    }),
    hostToolResult: vi.fn(async () => {}),
    hostExecuteEvent: vi.fn(async () => {}),
    hostExecuteResult: vi.fn(async () => {}),
    closeSession: vi.fn(async () => {}),
  };
}

function hostRoutedEngine(coreUsage?: unknown): CoreEngine {
  let listener: ((event: BridgeEvent) => void) | undefined;
  const input: ExecutionRequest = {
    request_id: "provider-request",
    run_id: "provider-request",
    system_prompt: "s",
    messages: [],
    tools: [],
    extended_thinking: false,
    params: { model: "google/gemini-2.5-flash" },
  };
  return {
    createSession: vi.fn(async () => "selector-session"),
    subscribe: vi.fn(async (_id, onEvent) => { listener = onEvent; }),
    mutate: vi.fn(async () => {
      listener?.({ kind: "host_execute_call", data: { call_id: "host-execute", tool: "backend.execute", input } });
    }),
    hostToolResult: vi.fn(async () => {}),
    hostExecuteEvent: vi.fn(async () => {}),
    hostExecuteResult: vi.fn(async () => {
      if (coreUsage) listener?.({ kind: "event", data: { event: { UsageUpdated: { usage: coreUsage } } } as never });
      listener?.({ kind: "event", data: { event: { AssistantTextDelta: { delta: "{\"ranges\":[]}" } } } as never });
      listener?.({ kind: "event", data: { event: { Completed: { outcome: "Success" } } } as never });
    }),
    closeSession: vi.fn(async () => {}),
  };
}

const usage = (requestsDone: number, input: number, output: number) => ({
  UsageUpdated: { usage: { agent_id: "a", metrics: { total_requests: requestsDone, input_tokens: input, output_tokens: output, total_tokens: input + output } } },
});

function request(onUsage: SelectorModelRequest["onUsage"]): SelectorModelRequest {
  return {
    providerId: "anthropic",
    modelId: "claude-haiku",
    provider: { id: "anthropic", name: "Anthropic", apiType: "anthropic-messages", baseUrl: "https://api.anthropic.com", apiKey: "k", models: [] } as unknown as CustomProvider,
    systemPrompt: "s",
    userPrompt: "u",
    signal: new AbortController().signal,
    onUsage,
  };
}

function successfulAnswerer(result: ExecutionResult): ExecutionAnswerer {
  return { execute: vi.fn(async () => result) };
}

const providerResult: ExecutionResult = {
  request_id: "provider-request",
  usage: {
    input_tokens: 1_250,
    output_tokens: 75,
    cache_read_tokens: 50,
    cache_write_tokens: 0,
    reasoning_tokens: 25,
    total_tokens: 1_375,
  },
  cost: { amount_usd: null, source: null },
  finish_reason: "end_turn",
};

describe("RoutedSelectorModelInvoker usage", () => {
  it("reports the session's usage once, without double-counting repeated snapshots", async () => {
    const onUsage = vi.fn();
    const engine = scriptedEngine([
      usage(0, 900, 1),
      { AssistantTextDelta: { delta: "{\"ranges\":[]}" } },
      usage(0, 900, 40),
      { Completed: { outcome: "Success" } },
    ]);

    const text = await new RoutedSelectorModelInvoker({ engine }).invoke(request(onUsage));

    expect(text).toBe("{\"ranges\":[]}");
    expect(onUsage).toHaveBeenCalledTimes(1);
    expect(onUsage).toHaveBeenCalledWith(expect.objectContaining({ input: 900, output: 40, totalTokens: 940 }));
  });

  it("still reports tokens spent by a selector session that failed", async () => {
    const onUsage = vi.fn();
    const engine = scriptedEngine([usage(0, 500, 5), { Failed: { error: { message: "overloaded" } } }]);

    await expect(new RoutedSelectorModelInvoker({ engine }).invoke(request(onUsage))).rejects.toThrow("overloaded");
    expect(onUsage).toHaveBeenCalledWith(expect.objectContaining({ totalTokens: 505 }));
  });

  it("falls back to terminal host execution usage when core emits no UsageUpdated event", async () => {
    const onUsage = vi.fn();
    const engine = hostRoutedEngine();

    const text = await new RoutedSelectorModelInvoker({
      engine,
      executionAnswerer: successfulAnswerer(providerResult),
    }).invoke(request(onUsage));

    expect(text).toBe("{\"ranges\":[]}");
    expect(onUsage).toHaveBeenCalledTimes(1);
    expect(onUsage).toHaveBeenCalledWith({
      input: 1_250,
      output: 75,
      cacheRead: 50,
      cacheWrite: 0,
      reasoning: 25,
      totalTokens: 1_375,
    });
  });

  it("waits for host result usage if core completes before the host delivery promise settles", async () => {
    const onUsage = vi.fn();
    const engine = hostRoutedEngine();
    let resolveExecution!: (result: ExecutionResult) => void;
    const executionAnswerer: ExecutionAnswerer = {
      execute: vi.fn(() => new Promise<ExecutionResult>((resolve) => { resolveExecution = resolve; })),
    };

    const invocation = new RoutedSelectorModelInvoker({ engine, executionAnswerer }).invoke(request(onUsage));
    await Promise.resolve();
    await Promise.resolve();
    resolveExecution(providerResult);

    await expect(invocation).resolves.toBe("{\"ranges\":[]}");
    expect(onUsage).toHaveBeenCalledWith(expect.objectContaining({ totalTokens: 1_375 }));
  });

  it("prefers core usage snapshots over the host fallback instead of double-counting", async () => {
    const onUsage = vi.fn();
    const coreUsage = {
      agent_id: "selector-agent",
      metrics: { total_requests: 0, input_tokens: 1_250, output_tokens: 75, total_tokens: 1_375 },
    };

    await new RoutedSelectorModelInvoker({
      engine: hostRoutedEngine(coreUsage),
      executionAnswerer: successfulAnswerer(providerResult),
    }).invoke(request(onUsage));

    expect(onUsage).toHaveBeenCalledTimes(1);
    expect(onUsage).toHaveBeenCalledWith(expect.objectContaining({ input: 1_250, output: 75, totalTokens: 1_375 }));
  });
});
