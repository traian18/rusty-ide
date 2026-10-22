import { afterEach, describe, expect, it, vi } from "vitest";

import type { CustomProvider } from "../../../store/types";
import { testProviderInferenceDirect } from "./providerCatalog";

function provider(overrides: Partial<CustomProvider> = {}): CustomProvider {
  return {
    id: "compatible-gateway",
    name: "Compatible Gateway",
    baseUrl: "https://gateway.example.test/v1/",
    apiKey: "gateway-key",
    apiType: "openai-completions",
    models: [],
    ...overrides,
  };
}

describe("testProviderInferenceDirect", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("sends a HEAD to the chat completions endpoint with auth and the provider's non-secret headers", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 200 }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const result = await testProviderInferenceDirect(provider({
      headers: [
        { name: "X-Team", value: "rusty" },
        { name: "X-Secret", value: "hidden", secret: true },
      ],
    }));

    expect(result).toEqual({ success: true });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://gateway.example.test/v1/chat/completions");
    expect(init.method).toBe("HEAD");
    expect(init.headers).toEqual({ Accept: "application/json", Authorization: "Bearer gateway-key", "X-Team": "rusty" });
  });

  it("uses Anthropic's key header and version for an anthropic provider", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 405 }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await testProviderInferenceDirect(provider({ authType: "anthropic", apiKey: "anthropic-key" }));

    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(init.headers).toEqual({ Accept: "application/json", "x-api-key": "anthropic-key", "anthropic-version": "2023-06-01" });
  });

  it.each([
    [200, { success: true }],
    [401, { success: true }],
    [403, { success: true }],
    [405, { success: true }],
    [404, { success: false, message: "Inference endpoint not found at this URL" }],
    [500, { success: false, message: "Provider returned status 500" }],
  ])("reports status %i as %o", async (status, expected) => {
    globalThis.fetch = vi.fn(async () => new Response(null, { status })) as typeof fetch;

    await expect(testProviderInferenceDirect(provider())).resolves.toEqual(expected);
  });

  it("reports a network failure instead of throwing", async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error("connection refused");
    }) as typeof fetch;

    await expect(testProviderInferenceDirect(provider())).resolves.toEqual({
      success: false,
      message: "Could not reach the provider: connection refused",
    });
  });

  it("rejects a base URL that is not http or https", async () => {
    await expect(testProviderInferenceDirect(provider({ baseUrl: "ftp://gateway.example.test" })))
      .rejects.toThrow("Provider URLs must use http or https.");
  });
});
