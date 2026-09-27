import { describe, expect, it, vi } from "vitest";
import type { CustomProvider } from "../../../store/types";
import type { BridgeEvent, CoreEngine } from "../engine/CoreEngineClient";
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
});
