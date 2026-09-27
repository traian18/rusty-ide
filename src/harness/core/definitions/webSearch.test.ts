import { afterEach, describe, expect, it, vi } from "vitest";

import { runWebSearch, type WebSearchApiKeys } from "./webSearch";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function textResponse(body: string, status = 200): Response {
  return new Response(body, { status, headers: { "content-type": "text/event-stream" } });
}

describe("runWebSearch", () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("throws a clear error when an explicit provider has no configured key", async () => {
    await expect(runWebSearch("hello", { provider: "brave" }, {})).rejects.toThrow(/Brave Search unavailable.*Settings > Web Search/);
  });

  it("calls Brave's API with the right auth header and parses results", async () => {
    const fetchMock = vi.fn(async (url: string | URL, _init?: RequestInit) => {
      expect(String(url)).toContain("api.search.brave.com");
      return jsonResponse({ web: { results: [{ title: "A", url: "https://a.test", description: "desc" }] } });
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const response = await runWebSearch("query", { provider: "brave" }, { brave: "brave-key" });

    expect(response.provider).toBe("brave");
    expect(response.results).toEqual([{ title: "A", url: "https://a.test", snippet: "desc" }]);
    const [, init] = fetchMock.mock.calls[0];
    expect((init as RequestInit).headers).toMatchObject({ "X-Subscription-Token": "brave-key" });
  });

  it("excludes a NOT-site domain filter from the Brave query string", async () => {
    const fetchMock = vi.fn(async (url: string | URL) => {
      expect(String(url)).toContain("NOT+site%3Aexample.test");
      return jsonResponse({ web: { results: [] } });
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await runWebSearch("query", { provider: "brave", domainFilter: ["-example.test"] }, { brave: "k" });
  });

  it("calls Tavily's API and maps its answer/results", async () => {
    globalThis.fetch = vi.fn(async () => jsonResponse({ answer: "The answer.", results: [{ title: "T", url: "https://t.test", content: "  spaced  out  " }] })) as unknown as typeof fetch;

    const response = await runWebSearch("query", { provider: "tavily" }, { tavily: "tavily-key" });

    expect(response).toEqual({ provider: "tavily", answer: "The answer.", results: [{ title: "T", url: "https://t.test", snippet: "spaced out" }] });
  });

  it("throws when Gemini returns no candidates worth surfacing", async () => {
    globalThis.fetch = vi.fn(async () => jsonResponse({ candidates: [] })) as unknown as typeof fetch;

    await expect(runWebSearch("query", { provider: "gemini" }, { gemini: "gemini-key" })).rejects.toThrow(/returned no answer or sources/);
  });

  it("falls back to Exa's no-key MCP endpoint when no Exa API key is configured", async () => {
    const fetchMock = vi.fn(async (url: string | URL) => {
      expect(String(url)).toBe("https://mcp.exa.ai/mcp");
      const text = "Title: MCP Result\nURL: https://mcp-result.test\nText: some content here\n";
      return textResponse(`data: ${JSON.stringify({ result: { content: [{ type: "text", text }] } })}\n`);
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const response = await runWebSearch("query", { provider: "exa" }, {});

    expect(response.provider).toBe("exa");
    expect(response.results).toEqual([{ title: "MCP Result", url: "https://mcp-result.test", snippet: "" }]);
  });

  it("auto mode tries providers in order and returns the first that succeeds", async () => {
    const calledUrls: string[] = [];
    globalThis.fetch = vi.fn(async (url: string | URL) => {
      const u = String(url);
      calledUrls.push(u);
      if (u.includes("mcp.exa.ai")) return new Response("no data lines here", { status: 200 });
      if (u.includes("api.tavily.com")) return jsonResponse({ answer: "tavily answer", results: [{ title: "T", url: "https://t.test", content: "c" }] });
      throw new Error(`unexpected fetch to ${u}`);
    }) as unknown as typeof fetch;

    const apiKeys: WebSearchApiKeys = { tavily: "tavily-key" };
    const response = await runWebSearch("query", {}, apiKeys);

    expect(response.provider).toBe("tavily");
    expect(calledUrls.some((u) => u.includes("mcp.exa.ai"))).toBe(true);
    expect(calledUrls.some((u) => u.includes("api.tavily.com"))).toBe(true);
  });

  it("auto mode throws, listing per-provider failures, when nothing succeeds (Exa's no-key MCP fallback is always attempted first)", async () => {
    globalThis.fetch = vi.fn(async () => new Response("", { status: 200 })) as unknown as typeof fetch;

    await expect(runWebSearch("query", {}, {})).rejects.toThrow(/Web search failed:\n {2}- Exa:/);
  });

  it("reports Perplexity's model and token usage", async () => {
    globalThis.fetch = vi.fn(async () => jsonResponse({
      model: "sonar",
      usage: { prompt_tokens: 12, completion_tokens: 80, total_tokens: 92 },
      choices: [{ message: { content: "Answer." } }],
      citations: ["https://p.test"],
    })) as unknown as typeof fetch;

    const response = await runWebSearch("q", { provider: "perplexity" }, { perplexity: "k" });

    expect(response.model).toBe("sonar");
    expect(response.usage).toEqual({ input: 12, output: 80, totalTokens: 92 });
  });

  it("reports Gemini's model version and token usage, including thinking tokens", async () => {
    globalThis.fetch = vi.fn(async () => jsonResponse({
      modelVersion: "gemini-3-flash-preview-09",
      usageMetadata: { promptTokenCount: 30, candidatesTokenCount: 120, thoughtsTokenCount: 40, totalTokenCount: 190 },
      candidates: [{ content: { parts: [{ text: "Grounded answer." }] } }],
    })) as unknown as typeof fetch;

    const response = await runWebSearch("q", { provider: "gemini" }, { gemini: "k" });

    expect(response.model).toBe("gemini-3-flash-preview-09");
    expect(response.usage).toEqual({ input: 30, output: 120, cacheRead: undefined, totalTokens: 190, reasoning: 40 });
  });

  it("reports OpenAI's model and token usage from the completed response", async () => {
    const completed = {
      type: "response.completed",
      response: {
        model: "gpt-5.4-2026-03-01",
        usage: { input_tokens: 900, input_tokens_details: { cached_tokens: 100 }, output_tokens: 250, output_tokens_details: { reasoning_tokens: 60 }, total_tokens: 1150 },
        output: [{ type: "message", content: [{ type: "output_text", text: "Answer.", annotations: [] }] }],
      },
    };
    globalThis.fetch = vi.fn(async () => textResponse(`data: ${JSON.stringify(completed)}\n\n`)) as unknown as typeof fetch;

    const response = await runWebSearch("q", { provider: "openai" }, { openai: "k" });

    expect(response.model).toBe("gpt-5.4-2026-03-01");
    expect(response.usage).toEqual({ input: 900, output: 250, cacheRead: 100, totalTokens: 1150, reasoning: 60 });
  });

  it("reports no model for plain search APIs", async () => {
    globalThis.fetch = vi.fn(async () => jsonResponse({ web: { results: [] } })) as unknown as typeof fetch;
    const response = await runWebSearch("q", { provider: "brave" }, { brave: "k" });
    expect(response.model).toBeUndefined();
    expect(response.usage).toBeUndefined();
  });
});
