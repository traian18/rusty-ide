import { describe, expect, it } from "vitest";

import type { CustomProvider } from "../store/types";
import type { ExecutionAnswerer } from "./core/CoreHarness";
import type { ExecutionEvent, ExecutionRequest, ExecutionResult } from "./core/engine/ExecutionProtocol";
import { HybridExecutionAnswerer } from "./HybridExecutionAnswerer";

class RecordingAnswerer implements ExecutionAnswerer {
  calls = 0;
  execute(): Promise<ExecutionResult> {
    this.calls += 1;
    return Promise.resolve({ request_id: "req-1", usage: {
      input_tokens: null, output_tokens: null, cache_read_tokens: null, cache_write_tokens: null, reasoning_tokens: null, total_tokens: null,
    }, cost: { amount_usd: null, source: null }, finish_reason: "stop" });
  }
}

function request(model: string): ExecutionRequest {
  return {
    request_id: "req-1",
    run_id: "run-1",
    system_prompt: "You are a test.",
    messages: [],
    tools: [],
    extended_thinking: false,
    params: { model },
  };
}

function provider(overrides: Partial<CustomProvider> = {}): CustomProvider {
  return {
    id: "anthropic",
    name: "Anthropic",
    baseUrl: "https://api.anthropic.com/v1",
    apiKey: "sk-test",
    apiType: "anthropic-messages",
    authType: "anthropic",
    models: [{ id: "anthropic/claude", remoteId: "claude", name: "Claude" }],
    ...overrides,
  };
}

const noopEvent = (_event: ExecutionEvent) => {};

describe("HybridExecutionAnswerer", () => {
  it("routes a ported apiType with a usable API key to the direct answerer", async () => {
    const direct = new RecordingAnswerer();
    const hybrid = new HybridExecutionAnswerer({ direct });

    await hybrid.execute(request("anthropic/claude"), provider(), noopEvent, new AbortController().signal);

    expect(direct.calls).toBe(1);
  });

  // Sidecar-removal Phase 8c: every case that used to fall back to the
  // sidecar now rejects with a clear, honest error instead -- there is no
  // fallback answerer left at all.

  it("rejects for an unported apiType (google-generative-ai), naming the apiType", async () => {
    const direct = new RecordingAnswerer();
    const hybrid = new HybridExecutionAnswerer({ direct });

    await expect(
      hybrid.execute(
        request("gemini/gemini-pro"),
        provider({ id: "gemini", apiType: "google-generative-ai", models: [{ id: "gemini/gemini-pro", remoteId: "gemini-pro", name: "Gemini Pro" }] }),
        noopEvent,
        new AbortController().signal,
      ),
    ).rejects.toThrow(/google-generative-ai/);
    expect(direct.calls).toBe(0);
  });

  it("rejects when no explicit API key is configured (the sidecar's own env-var fallback no longer exists)", async () => {
    const direct = new RecordingAnswerer();
    const hybrid = new HybridExecutionAnswerer({ direct });

    await expect(
      hybrid.execute(request("anthropic/claude"), provider({ apiKey: "" }), noopEvent, new AbortController().signal),
    ).rejects.toThrow(/could not resolve a runtime/);
    expect(direct.calls).toBe(0);
  });

  it("rejects for a managed transport provider, flagging it as a routing bug (it should never reach this class)", async () => {
    const direct = new RecordingAnswerer();
    const hybrid = new HybridExecutionAnswerer({ direct });

    await expect(
      hybrid.execute(
        request("github-copilot/gpt-4"),
        provider({ id: "github-copilot", transport: "github-copilot-sdk" }),
        noopEvent,
        new AbortController().signal,
      ),
    ).rejects.toThrow(/routing bug/);
    expect(direct.calls).toBe(0);
  });

  it("rejects when customProvider is missing", async () => {
    const direct = new RecordingAnswerer();
    const hybrid = new HybridExecutionAnswerer({ direct });

    await expect(hybrid.execute(request("anthropic/claude"), undefined, noopEvent, new AbortController().signal)).rejects.toThrow(
      /no provider was supplied/,
    );
    expect(direct.calls).toBe(0);
  });

  it("rejects for OpenCode -- its completions endpoint has no CORS support (confirmed live), naming the provider", async () => {
    const direct = new RecordingAnswerer();
    const hybrid = new HybridExecutionAnswerer({ direct });

    await expect(
      hybrid.execute(
        request("opencode/big-pickle"),
        provider({
          id: "opencode",
          name: "OpenCode Zen",
          baseUrl: "https://opencode.ai/zen/v1",
          apiType: "openai-completions",
          authType: "bearer",
          models: [{ id: "opencode/big-pickle", remoteId: "big-pickle", name: "Big Pickle" }],
        }),
        noopEvent,
        new AbortController().signal,
      ),
    ).rejects.toThrow(/opencode.*no CORS support/);
    expect(direct.calls).toBe(0);
  });

  it("rejects for OpenCode-Go too", async () => {
    const direct = new RecordingAnswerer();
    const hybrid = new HybridExecutionAnswerer({ direct });

    await expect(
      hybrid.execute(
        request("opencode-go/big-pickle"),
        provider({
          id: "opencode-go",
          name: "OpenCode Go",
          baseUrl: "https://opencode.ai/zen/go/v1",
          apiType: "openai-completions",
          authType: "bearer",
          models: [{ id: "opencode-go/big-pickle", remoteId: "big-pickle", name: "Big Pickle" }],
        }),
        noopEvent,
        new AbortController().signal,
      ),
    ).rejects.toThrow(/opencode-go.*no CORS support/);
    expect(direct.calls).toBe(0);
  });
});
