import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ModelUsage } from "./ExecutionProtocol";
import { recoverOpenRouterUsage } from "./openRouterUsageRecovery";

const emptyUsage: ModelUsage = {
  input_tokens: null,
  output_tokens: null,
  cache_read_tokens: null,
  cache_write_tokens: null,
  reasoning_tokens: null,
  total_tokens: null,
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("recoverOpenRouterUsage", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = vi.fn() as unknown as typeof fetch;
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    globalThis.fetch = originalFetch;
  });

  it("recovers native token counts from OpenRouter generation metadata", async () => {
    const fetchMock = vi.mocked(globalThis.fetch);
    fetchMock.mockResolvedValue(jsonResponse({
      data: {
        native_tokens_prompt: 1_000,
        native_tokens_completion: 75,
        native_tokens_cached: 200,
        native_tokens_reasoning: 25,
      },
    }));

    const usage = await recoverOpenRouterUsage(
      "openrouter",
      "https://openrouter.ai/api/v1",
      "sk-or-test",
      "gen-test",
      emptyUsage,
      new AbortController().signal,
    );

    expect(fetchMock).toHaveBeenCalledWith(
      new URL("https://openrouter.ai/api/v1/generation?id=gen-test"),
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: "Bearer sk-or-test" }) }),
    );
    expect(usage).toEqual({
      input: 800,
      output: 75,
      cacheRead: 200,
      cacheWrite: 0,
      reasoning: 25,
      totalTokens: 1_075,
    });
  });

  it("retries briefly while generation metadata is not ready", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.mocked(globalThis.fetch);
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ error: "not found" }, 404))
      .mockResolvedValueOnce(jsonResponse({
        data: { tokens_prompt: 100, tokens_completion: 20 },
      }));

    const pending = recoverOpenRouterUsage(
      "openrouter",
      "https://openrouter.ai/api/v1",
      "sk-or-test",
      "gen-test",
      emptyUsage,
      new AbortController().signal,
    );
    await vi.advanceTimersByTimeAsync(150);

    await expect(pending).resolves.toEqual(expect.objectContaining({ input: 100, output: 20, totalTokens: 120 }));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not make another request when streamed usage is already present", async () => {
    const fetchMock = vi.mocked(globalThis.fetch);
    const usage = await recoverOpenRouterUsage(
      "openrouter",
      "https://openrouter.ai/api/v1",
      "sk-or-test",
      "gen-test",
      { ...emptyUsage, total_tokens: 42 },
      new AbortController().signal,
    );

    expect(usage).toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("is a no-op for non-OpenRouter providers and non-retryable failures", async () => {
    const fetchMock = vi.mocked(globalThis.fetch);
    fetchMock.mockResolvedValue(jsonResponse({ error: "unauthorized" }, 401));

    await expect(recoverOpenRouterUsage(
      "anthropic",
      "https://api.anthropic.com/v1",
      "key",
      "gen-test",
      emptyUsage,
      new AbortController().signal,
    )).resolves.toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();

    await expect(recoverOpenRouterUsage(
      "openrouter",
      "https://openrouter.ai/api/v1",
      "key",
      "gen-test",
      emptyUsage,
      new AbortController().signal,
    )).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
