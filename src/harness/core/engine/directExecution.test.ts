import { afterEach, describe, expect, it, vi } from "vitest";

import type { CustomProvider } from "../../../store/types";
import type { ExecutionEvent, ExecutionRequest } from "./ExecutionProtocol";
import { isMistralUrl, PORTED_API_TYPES, setMistralRetryDelaysForTests, resolveDirectRuntime, runDirectExecution } from "./directExecution";

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
  it("carries exactly the four apiTypes this app's own default providers use", () => {
    expect(PORTED_API_TYPES).toEqual(new Set(["openai-completions", "openai-responses", "anthropic-messages", "mistral-conversations"]));
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
    registration.setResponses([pi.fauxAssistantMessage([pi.fauxText("Hi there.")], { responseId: "gen-direct-1" })]);

    const events: ExecutionEvent[] = [];
    try {
      const result = await runDirectExecution(
        executionRequest({ params: { model: "faux-direct-provider/faux-model" } }),
        fauxProvider(registration.api, "faux-direct-provider", "faux-model"),
        (event) => events.push(event),
        new AbortController().signal,
      );

      expect(result.request_id).toBe("req-1");
      expect(result.response_id).toBe("gen-direct-1");
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

describe("Mistral requests", () => {
  afterEach(() => vi.unstubAllGlobals());

  // Set up the way most people do it: Mistral's OpenAI-looking URL with the
  // OpenAI Chat Completions protocol.
  const mistral: CustomProvider = {
    id: "mistral",
    name: "Mistral",
    baseUrl: "https://api.mistral.ai/v1",
    apiKey: "key",
    apiType: "openai-completions",
    authType: "bearer",
    models: [{ id: "mistral/mistral-large-latest", remoteId: "mistral-large-latest", name: "Mistral Large" }],
  };

  async function capture(provider: CustomProvider, request: ExecutionRequest) {
    const calls: { url: string; headers: Headers; body: any }[] = [];
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      const req = input instanceof Request ? input : new Request(String(input), init);
      calls.push({ url: req.url, headers: req.headers, body: await req.clone().json().catch(() => undefined) });
      return new Response("{}", { status: 400, headers: { "content-type": "application/json" } });
    });
    await runDirectExecution(request, provider, () => undefined, new AbortController().signal).catch(() => undefined);
    expect(calls.length).toBeGreaterThan(0);
    return calls[0];
  }

  it("recognizes Mistral's endpoints", () => {
    expect(isMistralUrl("https://api.mistral.ai/v1")).toBe(true);
    expect(isMistralUrl("https://codestral.mistral.ai/v1")).toBe(true);
    expect(isMistralUrl("https://api.openai.com/v1")).toBe(false);
    expect(isMistralUrl("https://notmistral.ai.example.com/v1")).toBe(false);
    expect(isMistralUrl("")).toBe(false);
  });

  it("uses the native Mistral API even for a provider set up as OpenAI-compatible", () => {
    const runtime = resolveDirectRuntime("mistral/mistral-large-latest", mistral);
    expect(runtime?.model.api).toBe("mistral-conversations");
    expect(runtime?.model.baseUrl).toBe("https://api.mistral.ai");
    expect(PORTED_API_TYPES.has("mistral-conversations")).toBe(true);
  });

  it("sends a Mistral chat request with only headers Mistral's CORS rules allow", async () => {
    const call = await capture(mistral, executionRequest({
      params: { model: "mistral/mistral-large-latest", max_tokens: 1000, temperature: 0.2 },
      tools: [{ name: "read_file", description: "Read a file", input_schema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] } }],
    }));
    expect(call.url).toBe("https://api.mistral.ai/v1/chat/completions");
    const allowed = ["authorization", "content-type", "user-agent", "cache-control", "keep-alive", "x-mistral-user-agent", "accept"];
    // The SDK always sets an empty `cookie`; a browser drops it (a forbidden header), so it never reaches the preflight.
    expect(call.headers.get("cookie") ?? "").toBe("");
    expect([...call.headers.keys()].filter((name) => !allowed.includes(name) && name !== "cookie")).toEqual([]);
    expect(call.headers.get("authorization")).toBe("Bearer key");
    expect(call.body.model).toBe("mistral-large-latest");
    expect(call.body.max_tokens).toBe(1000);
    expect(call.body.messages.map((message: any) => message.role)).toEqual(["system", "user"]);
    expect(call.body.tools[0].function.name).toBe("read_file");
    const accepted = ["model", "messages", "stream", "max_tokens", "temperature", "top_p", "stop", "random_seed", "response_format",
      "tools", "tool_choice", "presence_penalty", "frequency_penalty", "n", "parallel_tool_calls", "prompt_mode", "safe_prompt", "prediction",
      "reasoning_effort", "prompt_cache_key"];
    expect(Object.keys(call.body).filter((key) => !accepted.includes(key))).toEqual([]);
  });

  it("keeps other OpenAI-compatible providers on the OpenAI client", async () => {
    const other = { ...mistral, id: "other", baseUrl: "https://api.example.com/v1", models: [{ id: "other/m", remoteId: "m", name: "M" }] };
    expect(resolveDirectRuntime("other/m", other)?.model.api).toBe("openai-completions");
    const call = await capture(other, executionRequest({ params: { model: "other/m" } }));
    expect(call.url).toBe("https://api.example.com/v1/chat/completions");
  });

  function sse(chunks: object[]): Response {
    const body = chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join("") + "data: [DONE]\n\n";
    return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
  }
  const failedStream = () => sse([{ id: "c1", object: "chat.completion.chunk", created: 1, model: "m", choices: [{ index: 0, delta: { role: "assistant", content: "" }, finish_reason: "error" }] }]);
  const goodStream = () => sse([
    { id: "c2", object: "chat.completion.chunk", created: 1, model: "m", choices: [{ index: 0, delta: { role: "assistant", content: "Hello" }, finish_reason: null }] },
    { id: "c2", object: "chat.completion.chunk", created: 1, model: "m", choices: [{ index: 0, delta: { content: "" }, finish_reason: "stop" }], usage: { prompt_tokens: 3, completion_tokens: 1, total_tokens: 4 } },
  ]);

  it("retries when Mistral ends a stream with finish_reason error before sending anything", async () => {
    setMistralRetryDelaysForTests([1, 1, 1]);
    const responses = [failedStream(), failedStream(), goodStream()];
    let calls = 0;
    vi.stubGlobal("fetch", async () => responses[calls++]);
    const events: ExecutionEvent[] = [];
    const result = await runDirectExecution(executionRequest({ params: { model: "mistral/mistral-large-latest" } }), mistral, (event) => events.push(event), new AbortController().signal);
    expect(calls).toBe(3);
    expect(result.finish_reason).toBe("stop");
    expect(events.filter((event) => "TextDelta" in event).map((event: any) => event.TextDelta.delta)).toEqual(["Hello"]);
  });

  it("gives up after a few retries with an error that says what happened", async () => {
    setMistralRetryDelaysForTests([1, 1]);
    let calls = 0;
    vi.stubGlobal("fetch", async () => { calls++; return failedStream(); });
    await expect(runDirectExecution(executionRequest({ params: { model: "mistral/mistral-large-latest" } }), mistral, () => undefined, new AbortController().signal))
      .rejects.toThrow(/Mistral ended the response with an error on its side \(after 2 retries\)/);
    expect(calls).toBe(3);
  });

  it("does not retry a request Mistral rejected", async () => {
    setMistralRetryDelaysForTests([1, 1]);
    let calls = 0;
    vi.stubGlobal("fetch", async () => { calls++; return new Response(JSON.stringify({ message: "bad request" }), { status: 400, headers: { "content-type": "application/json" } }); });
    await expect(runDirectExecution(executionRequest({ params: { model: "mistral/mistral-large-latest" } }), mistral, () => undefined, new AbortController().signal)).rejects.toThrow(/400/);
    expect(calls).toBe(1);
  });

  it("retries when the connection drops before Mistral answers (WebKit's \"Load failed\")", async () => {
    setMistralRetryDelaysForTests([1, 1, 1]);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    let calls = 0;
    vi.stubGlobal("fetch", async () => {
      calls++;
      if (calls === 1) throw new TypeError("Load failed");
      return goodStream();
    });
    const result = await runDirectExecution(executionRequest({ params: { model: "mistral/mistral-large-latest" } }), mistral, () => undefined, new AbortController().signal);
    expect(calls).toBe(2);
    expect(result.finish_reason).toBe("stop");
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("Load failed"));
    warn.mockRestore();
  });
});

describe("direct runtime resolution", () => {
  const lab: CustomProvider = {
    id: "lab",
    name: "Lab",
    baseUrl: "https://lab.invalid/v1//",
    apiKey: " key ",
    apiType: "openai-completions",
    authType: "bearer",
    models: [
      { id: "lab/first", remoteId: "first-remote", name: "First" },
      { id: "lab/second", name: "Second", baseUrl: "https://second.invalid/v2/", apiType: "openai-responses", contextWindow: 1000, maxTokens: 50, reasoningEffort: "low" },
    ],
  };
  const bare = (changes: Partial<CustomProvider>): CustomProvider => ({ id: "x", name: "X", baseUrl: "", apiKey: "k", apiType: "", models: [], ...changes });

  it("falls back to the provider's first model, trimming its key and base URL", () => {
    const runtime = resolveDirectRuntime("", lab)!;
    expect(runtime).toMatchObject({ providerId: "lab", modelId: "first-remote", apiKey: "key", headers: undefined });
    expect(runtime.model).toMatchObject({
      id: "first-remote", name: "First", api: "openai-completions", provider: "lab", baseUrl: "https://lab.invalid/v1",
      reasoning: false, input: ["text"], contextWindow: 200_000, maxTokens: 16_384,
    });
  });

  it("uses the selected model's own URL, protocol, limits and reasoning effort", () => {
    const runtime = resolveDirectRuntime("lab/second", lab)!;
    expect(runtime.modelId).toBe("second");
    expect(runtime.reasoningEffort).toBe("low");
    expect(runtime.model).toMatchObject({ name: "Second", baseUrl: "https://second.invalid/v2", api: "openai-responses", contextWindow: 1000, maxTokens: 50 });
  });

  it("finds a model by its remote id and takes the effort the reference names", () => {
    const runtime = resolveDirectRuntime("first-remote::reasoning=high", lab)!;
    expect(runtime).toMatchObject({ modelId: "first-remote", reasoningEffort: "high" });
    expect(runtime.model.name).toBe("First");
  });

  it("takes the URL, protocol, auth and headers a known provider needs from its defaults", () => {
    const openrouter = resolveDirectRuntime("openrouter/m", bare({ id: "openrouter" }))!;
    expect(openrouter.model).toMatchObject({ id: "m", name: "m", baseUrl: "https://openrouter.ai/api/v1", api: "openai-completions" });
    expect(openrouter.headers).toEqual({ "HTTP-Referer": "https://rusty.dev", "X-Title": "Rusty" });

    const github = resolveDirectRuntime("github-models/gpt", bare({
      id: "github-models",
      headers: [{ name: "X-GitHub-Api-Version", value: "2022-11-28" }, { name: "Authorization", value: "ignored" }, { name: "X-Team", value: "rusty" }],
    }))!;
    expect(github.headers).toEqual({ Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", "X-Team": "rusty" });
  });

  it("sends a bearer header for an Anthropic-protocol provider that authenticates with one", () => {
    const proxy = resolveDirectRuntime("x/claude", bare({ baseUrl: "https://proxy.invalid", apiType: "anthropic", authType: "bearer" }))!;
    expect(proxy.model.api).toBe("anthropic-messages");
    expect(proxy.headers).toEqual({ Authorization: "Bearer k" });
  });

  it("needs no key when neither the provider nor its defaults ask for one", () => {
    expect(resolveDirectRuntime("x/m", bare({ baseUrl: "http://localhost:1", apiKey: "" }))?.apiKey).toBe("not-needed");
  });

  it("resolves nothing without a model, and refuses a provider without a base URL", () => {
    expect(resolveDirectRuntime("", bare({ baseUrl: "http://localhost:1" }))).toBeUndefined();
    expect(() => resolveDirectRuntime("x/m", bare({ name: "Nowhere" }))).toThrow("No base URL is configured for Nowhere.");
  });
});

describe("direct execution responses", () => {
  let sequence = 0;
  async function run(respond: (pi: any) => unknown, request: Partial<ExecutionRequest> = {}) {
    const pi = await fauxPi();
    sequence += 1;
    const registration = pi.registerFauxProvider({ api: `rusty-direct-faux-responses-${sequence}`, provider: "faux-responses" });
    registration.setResponses([respond(pi)]);
    const events: ExecutionEvent[] = [];
    try {
      const result = await runDirectExecution(
        executionRequest({ params: { model: "faux-responses/faux-model" }, ...request }),
        fauxProvider(registration.api, "faux-responses", "faux-model"),
        (event) => events.push(event),
        new AbortController().signal,
      );
      return { result, events };
    } finally {
      registration.unregister();
    }
  }
  const streamed = (events: ExecutionEvent[], kind: "TextDelta" | "ReasoningDelta") =>
    events.map((event) => (event as Record<string, { delta?: string }>)[kind]?.delta ?? "").join("");

  it("streams reasoning and text as separate events", async () => {
    const { result, events } = await run((pi) => pi.fauxAssistantMessage([pi.fauxThinking("plan it"), pi.fauxText("Done.")]));
    expect(streamed(events, "ReasoningDelta")).toBe("plan it");
    expect(streamed(events, "TextDelta")).toBe("Done.");
    expect(result.finish_reason).toBe("stop");
    expect(result).not.toHaveProperty("response_id");
  });

  it("fails with the model's own error message", async () => {
    await expect(run((pi) => pi.fauxAssistantMessage([], { stopReason: "error", errorMessage: "quota exceeded" }))).rejects.toThrow("quota exceeded");
  });

  it("rejects an answer with no text and no tool calls", async () => {
    await expect(run((pi) => pi.fauxAssistantMessage([pi.fauxText("   ")]))).rejects.toThrow("The selected model returned no text. (stop reason: stop)");
  });

  it("keeps an output-limited empty answer, so the harness can continue it", async () => {
    const { result } = await run((pi) => pi.fauxAssistantMessage([pi.fauxThinking("long")], { stopReason: "length" }));
    expect(result.finish_reason).toBe("length");
  });

  it("sends images as a placeholder and a user's tool results as text, skipping empty messages", async () => {
    let seen: any[] = [];
    await run((pi) => (context: any) => {
      seen = context.messages;
      return pi.fauxAssistantMessage([pi.fauxText("ok")]);
    }, {
      messages: [
        { id: "m0", role: "User", content: [], created_at: "not a date" },
        {
          id: "m1",
          role: "User",
          content: [
            { Image: { media_type: "image/png", data: "" } },
            { ToolResult: { call_id: "c1", result: { has_error: false, output_preview: JSON.stringify("from a tool") } } },
          ],
          created_at: new Date().toISOString(),
        },
        { id: "m2", role: "Tool", content: [{ ToolResult: { call_id: "unknown", result: { has_error: true, output_preview: "not json" } } }], created_at: new Date().toISOString() },
      ] as ExecutionRequest["messages"],
    });
    expect(seen).toHaveLength(2);
    expect(seen[0]).toMatchObject({ role: "user", content: [{ type: "text", text: "[image omitted]" }, { type: "text", text: "from a tool" }] });
    expect(seen[1]).toMatchObject({ role: "toolResult", toolCallId: "unknown", toolName: "", isError: true, content: [{ type: "text", text: "not json" }] });
  });
});
