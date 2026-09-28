import { afterEach, describe, expect, it, vi } from "vitest";

import type { CustomProvider } from "../../../store/types";
import { discoverProviderModelsDirect } from "./providerCatalog";

function openRouterProvider(overrides: Partial<CustomProvider> = {}): CustomProvider {
  return {
    id: "openrouter",
    name: "OpenRouter",
    baseUrl: "https://openrouter.ai/api/v1",
    apiKey: "or-key",
    apiType: "openai-completions",
    authType: "bearer",
    catalogUrl: "https://openrouter.ai/api/v1/models",
    models: [],
    ...overrides,
  };
}

function emptyCatalog(): Response {
  return new Response(JSON.stringify({ data: [] }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

describe("OpenRouter account-aware model discovery", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("uses the authenticated user catalog so guardrails and privacy settings filter models", async () => {
    globalThis.fetch = vi.fn(async (input, init) => {
      expect(String(input)).toBe("https://openrouter.ai/api/v1/models/user");
      expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer or-key");
      return emptyCatalog();
    }) as typeof fetch;

    await discoverProviderModelsDirect(openRouterProvider());
  });

  it("keeps the public catalog when no API key is available", async () => {
    globalThis.fetch = vi.fn(async (input) => {
      expect(String(input)).toBe("https://openrouter.ai/api/v1/models");
      return emptyCatalog();
    }) as typeof fetch;

    await discoverProviderModelsDirect(openRouterProvider({ apiKey: "" }));
  });

  it("does not rewrite a custom OpenRouter catalog or proxy URL", async () => {
    globalThis.fetch = vi.fn(async (input) => {
      expect(String(input)).toBe("https://gateway.example.test/openrouter/models");
      return emptyCatalog();
    }) as typeof fetch;

    await discoverProviderModelsDirect(openRouterProvider({
      catalogUrl: "https://gateway.example.test/openrouter/models",
    }));
  });
});
