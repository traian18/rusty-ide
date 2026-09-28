import { afterEach, describe, expect, it, vi } from "vitest";

import type { CustomProvider } from "../../../store/types";
import { discoverProviderModelsDirect } from "./providerCatalog";

function openRouterProvider(): CustomProvider {
  return {
    id: "openrouter",
    name: "OpenRouter",
    baseUrl: "https://openrouter.ai/api/v1",
    apiKey: "or-test-key",
    apiType: "openai-completions",
    authType: "bearer",
    models: [],
  };
}

describe("OpenRouter JEV catalogue discovery", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("preserves chat router, versioned JEV, and latest alias entries without making decision models chat-selectable", async () => {
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({
      data: [
        {
          id: "typesafe/jev-router",
          name: "TypeSafe: Jev Router",
          architecture: { input_modalities: ["text"], output_modalities: ["text"] },
        },
        {
          id: "typesafe/jev-1.13",
          name: "TypeSafe: Jev 1.13",
          architecture: { input_modalities: ["text"], output_modalities: ["decisions"] },
        },
        {
          id: "~typesafe/jev-latest",
          name: "TypeSafe: Jev Latest",
          architecture: { input_modalities: ["text"], output_modalities: ["decisions"] },
        },
      ],
    }), { status: 200, headers: { "content-type": "application/json" } })) as typeof fetch;

    const models = await discoverProviderModelsDirect(openRouterProvider());

    const requestedUrl = new URL(String(vi.mocked(globalThis.fetch).mock.calls[0][0]));
    expect(requestedUrl.pathname).toBe("/api/v1/models/user");
    expect(requestedUrl.searchParams.get("output_modalities")).toBe("all");
    expect(models).toHaveLength(3);
    expect(models.find((model) => model.remoteId === "typesafe/jev-router")?.supported).toBe(true);
    expect(models.find((model) => model.remoteId === "typesafe/jev-1.13")?.supported).toBe(false);
    expect(models.find((model) => model.remoteId === "~typesafe/jev-latest")?.supported).toBe(false);
  });
});
