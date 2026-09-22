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
});
