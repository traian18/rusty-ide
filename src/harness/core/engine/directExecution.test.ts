import { describe, expect, it } from "vitest";

import type { CustomProvider } from "../../../store/types";
import type { ExecutionEvent, ExecutionRequest } from "./ExecutionProtocol";
import { PORTED_API_TYPES, resolveDirectRuntime, runDirectExecution } from "./directExecution";

/** Same technique agent-sidecar/src/services/llmRuntime.test.ts uses for
 * `streamExecutionRequest`: pi-ai's own `registerFauxProvider` test utility
 * registers a real (in-process, no HTTP) provider implementation directly
 * in the pi-ai library that `directExecution.ts` imports for real --
 * exercising the actual `streamSimple` call path this module uses, not a
 * mocked stand-in for it. */
async function fauxPi() {
  return import("@earendil-works/pi-ai/compat") as any;
}

function fauxProvider(api: string, providerId: string, modelId: string): CustomProvider {
  return {
    id: providerId,
    name: "Faux Provider",
    baseUrl: "https://faux.invalid",
    apiKey: "",
    apiType: api,
    authType: "none",
    models: [{ id: `${providerId}/${modelId}`, remoteId: modelId, name: "Faux Model", apiType: api }],
  };
}

function executionRequest(overrides: Partial<ExecutionRequest> = {}): ExecutionRequest {
  return {
    request_id: "req-1",
    run_id: "run-1",
    system_prompt: "You are a test.",
    messages: [{ id: "m1", role: "User", content: [{ Text: { text: "hello" } }], created_at: new Date().toISOString() }],
    tools: [],
    extended_thinking: false,
    params: {},
    ...overrides,
  };
}

describe("PORTED_API_TYPES", () => {
  it("carries exactly the three apiTypes this app's own default providers use", () => {
    expect(PORTED_API_TYPES).toEqual(new Set(["openai-completions", "openai-responses", "anthropic-messages"]));
  });
});

describe("resolveDirectRuntime", () => {
  it("resolves a runtime for a provider with an explicit apiKey", () => {
    const provider: CustomProvider = {
      id: "anthropic",
      name: "Anthropic",
      baseUrl: "https://api.anthropic.com/v1",
      apiKey: "sk-test",
      apiType: "anthropic-messages",
      authType: "anthropic",
      models: [{ id: "anthropic/claude", remoteId: "claude", name: "Claude" }],
    };
    const runtime = resolveDirectRuntime("anthropic/claude", provider);
    expect(runtime?.modelId).toBe("claude");
    expect(runtime?.apiKey).toBe("sk-test");
    expect(runtime?.model.api).toBe("anthropic-messages");
  });

  it("returns undefined when no explicit apiKey is set and authType isn't 'none' -- the sidecar's own process.env fallback is intentionally not ported", () => {
    const provider: CustomProvider = {
      id: "anthropic",
      name: "Anthropic",
      baseUrl: "https://api.anthropic.com/v1",
      apiKey: "",
      apiType: "anthropic-messages",
      authType: "anthropic",
      models: [],
    };
    expect(resolveDirectRuntime("anthropic/claude", provider)).toBeUndefined();
  });

  it("resolves with a placeholder key when authType is 'none'", () => {
    const provider = fauxProvider("openai-completions", "faux", "model");
    const runtime = resolveDirectRuntime("faux/model", provider);
    expect(runtime?.apiKey).toBe("not-needed");
  });
});

describe("runDirectExecution", () => {
  it("resolves with the final ExecutionResult and forwards a UsageUpdate event", async () => {
    const pi = await fauxPi();
    const registration = pi.registerFauxProvider({ api: "rusty-direct-faux-test", provider: "faux-direct-provider" });
    registration.setResponses([pi.fauxAssistantMessage([pi.fauxText("Hi there.")])]);

    const events: ExecutionEvent[] = [];
    try {
      const result = await runDirectExecution(
        executionRequest({ params: { model: "faux-direct-provider/faux-model" } }),
        fauxProvider(registration.api, "faux-direct-provider", "faux-model"),
        (event) => events.push(event),
        new AbortController().signal,
      );

      expect(result.request_id).toBe("req-1");
      expect(result.finish_reason).toBe("stop");
      expect(events.some((event) => "UsageUpdate" in event)).toBe(true);
    } finally {
      registration.unregister();
    }
  });

  it("surfaces a requested tool call as a ToolCallRequested event with a minted UUID -- rusty-core's ToolCallId is a UUID newtype", async () => {
    const pi = await fauxPi();
    const registration = pi.registerFauxProvider({ api: "rusty-direct-faux-uuid-test", provider: "faux-direct-uuid-provider" });
    registration.setResponses([
      pi.fauxAssistantMessage([pi.fauxToolCall("list_files", {}, { id: "toolu_01ProviderStyleId" })], { stopReason: "toolUse" }),
    ]);

    const events: ExecutionEvent[] = [];
    try {
      const result = await runDirectExecution(
        executionRequest({
          tools: [{ id: "list_files", name: "list_files", description: "List.", input_schema: {} }],
          params: { model: "faux-direct-uuid-provider/faux-model" },
        }),
        fauxProvider(registration.api, "faux-direct-uuid-provider", "faux-model"),
        (event) => events.push(event),
        new AbortController().signal,
      );

      expect(result.finish_reason).toBe("tool_use");
      const toolCallEvent = events.find((event) => "ToolCallRequested" in event) as
        | { ToolCallRequested: { call: { id: string; name: string } } }
        | undefined;
      expect(toolCallEvent).toBeDefined();
      expect(toolCallEvent!.ToolCallRequested.call.name).toBe("list_files");
      expect(toolCallEvent!.ToolCallRequested.call.id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
      );
    } finally {
      registration.unregister();
    }
  });

  it("sends rusty-core ToolUse/Tool-result history as pi-ai toolCall parts and toolResult messages", async () => {
    const pi = await fauxPi();
    const registration = pi.registerFauxProvider({ api: "rusty-direct-faux-history-test", provider: "faux-direct-history-provider" });
    let seenMessages: any[] = [];
    registration.setResponses([
      (context: any) => {
        seenMessages = context.messages;
        return pi.fauxAssistantMessage([pi.fauxText("done")]);
      },
    ]);
    const callId = "11111111-2222-4333-8444-555555555555";
    try {
      await runDirectExecution(
        executionRequest({
          messages: [
            { id: "m1", role: "User", content: [{ Text: { text: "list the files" } }], created_at: new Date().toISOString() },
            {
              id: "m2",
              role: "Assistant",
              content: [{ ToolUse: { call: { id: callId, name: "list_files", arguments: {} } } }],
              created_at: new Date().toISOString(),
            },
            {
              id: "m3",
              role: "Tool",
              content: [{ ToolResult: { call_id: callId, result: { has_error: false, output_preview: JSON.stringify("a.ts\nb.ts") } } }],
              created_at: new Date().toISOString(),
            },
          ],
          params: { model: "faux-direct-history-provider/faux-model" },
        }),
        fauxProvider(registration.api, "faux-direct-history-provider", "faux-model"),
        () => {},
        new AbortController().signal,
      );
      expect(seenMessages.length).toBe(3);
      expect(seenMessages[1].role).toBe("assistant");
      expect(seenMessages[1].content).toEqual([{ type: "toolCall", id: callId, name: "list_files", arguments: {} }]);
      expect(seenMessages[1].stopReason).toBe("toolUse");
      expect(seenMessages[1].usage.totalTokens).toBe(0);
      expect(seenMessages[2].role).toBe("toolResult");
      expect(seenMessages[2].toolCallId).toBe(callId);
      expect(seenMessages[2].content).toEqual([{ type: "text", text: "a.ts\nb.ts" }]);
    } finally {
      registration.unregister();
    }
  });

  it("merges rusty-core's per-block Assistant messages into one pi-ai assistant turn", async () => {
    const pi = await fauxPi();
    const registration = pi.registerFauxProvider({ api: "rusty-direct-faux-merge-test", provider: "faux-direct-merge-provider" });
    let seenMessages: any[] = [];
    registration.setResponses([
      (context: any) => {
        seenMessages = context.messages;
        return pi.fauxAssistantMessage([pi.fauxText("done")]);
      },
    ]);
    const a = "11111111-2222-4333-8444-5555555555aa";
    const b = "11111111-2222-4333-8444-5555555555bb";
    const at = () => new Date().toISOString();
    try {
      await runDirectExecution(
        executionRequest({
          messages: [
            { id: "m1", role: "User", content: [{ Text: { text: "go" } }], created_at: at() },
            { id: "m2", role: "Assistant", content: [{ Text: { text: "Reading both." } }], created_at: at() },
            { id: "m3", role: "Assistant", content: [{ ToolUse: { call: { id: a, name: "read_file", arguments: { path: "a" } } } }], created_at: at() },
            { id: "m4", role: "Assistant", content: [{ ToolUse: { call: { id: b, name: "read_file", arguments: { path: "b" } } } }], created_at: at() },
            { id: "m5", role: "Tool", content: [{ ToolResult: { call_id: a, result: { has_error: false, output_preview: JSON.stringify("A") } } }], created_at: at() },
            { id: "m6", role: "Tool", content: [{ ToolResult: { call_id: b, result: { has_error: false, output_preview: JSON.stringify("B") } } }], created_at: at() },
          ],
          params: { model: "faux-direct-merge-provider/faux-model" },
        }),
        fauxProvider(registration.api, "faux-direct-merge-provider", "faux-model"),
        () => {},
        new AbortController().signal,
      );
      expect(seenMessages.map((m) => m.role)).toEqual(["user", "assistant", "toolResult", "toolResult"]);
      expect(seenMessages[1].content.map((p: any) => p.type)).toEqual(["text", "toolCall", "toolCall"]);
      expect(seenMessages[1].stopReason).toBe("toolUse");
      expect(seenMessages[1].content.filter((p: any) => p.type === "toolCall").map((p: any) => p.id)).toEqual([a, b]);
    } finally {
      registration.unregister();
    }
  });

  it("rejects when no runtime can be resolved (no API key configured)", async () => {
    const provider: CustomProvider = {
      id: "anthropic",
      name: "Anthropic",
      baseUrl: "https://api.anthropic.com/v1",
      apiKey: "",
      apiType: "anthropic-messages",
      authType: "anthropic",
      models: [],
    };
    await expect(
      runDirectExecution(executionRequest({ params: { model: "anthropic/claude" } }), provider, () => {}, new AbortController().signal),
    ).rejects.toThrow(/No API key is configured/);
  });
});
