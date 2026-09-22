import { afterEach, describe, expect, it, vi } from "vitest";

import type { CustomProvider } from "../../../store/types";
import { discoverProviderModelsDirect, fetchProviderQuotaDirect, testProviderConnectionDirect } from "./providerCatalog";

function provider(overrides: Partial<CustomProvider> = {}): CustomProvider {
  return {
    id: "github-models",
    name: "GitHub Models",
    baseUrl: "https://models.github.ai/inference",
    apiKey: "github-token",
    apiType: "openai-completions",
    authType: "bearer",
    catalogUrl: "https://models.github.ai/catalog/models",
    models: [],
    ...overrides,
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("discoverProviderModelsDirect", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("normalizes a GitHub catalog array and marks unsupported models", async () => {
    globalThis.fetch = vi.fn(async (_input, init) => {
      const headers = init?.headers as Record<string, string>;
      expect(headers.Authorization).toBe("Bearer github-token");
      expect(headers["X-GitHub-Api-Version"]).toBe("2026-03-10");
      return jsonResponse([
        { id: "openai/gpt-4.1", name: "GPT-4.1", capabilities: ["tool-calling"], supported_output_modalities: ["text"] },
        { id: "vendor/embedding-model", name: "Embedding Model", capabilities: ["embeddings"], supported_output_modalities: ["embeddings"] },
      ]);
    }) as typeof fetch;

    const models = await discoverProviderModelsDirect(provider());
    expect(models[0].id).toBe("github-models/openai/gpt-4.1");
    expect(models[0].remoteId).toBe("openai/gpt-4.1");
    expect(models[0].supported).toBe(true);
    expect(models[1].supported).toBe(false);
  });

  it("uses x-api-key authentication for an anthropic-messages custom catalog, not Authorization", async () => {
    globalThis.fetch = vi.fn(async (input, init) => {
      expect(String(input)).toBe("https://gateway.example.test/v1/models");
      const headers = init?.headers as Record<string, string>;
      expect(headers["x-api-key"]).toBe("anthropic-key");
      expect(headers["anthropic-version"]).toBe("2023-06-01");
      expect(headers.Authorization).toBeUndefined();
      return jsonResponse({ data: [{ id: "custom-sonnet" }] });
    }) as typeof fetch;

    const models = await discoverProviderModelsDirect(provider({
      id: "private-anthropic-gateway",
      name: "Private Anthropic Gateway",
      baseUrl: "https://gateway.example.test/v1",
      apiKey: "anthropic-key",
      apiType: "anthropic-messages",
      authType: "anthropic",
      catalogUrl: undefined,
    }));
    expect(models[0].apiType).toBe("anthropic-messages");
    expect(models[0].baseUrl).toBe("https://gateway.example.test/v1");
  });

  it("marks every model supported for an open-catalog provider (OpenCode)", async () => {
    globalThis.fetch = vi.fn(async () => jsonResponse({
      data: [{ id: "big-pickle", name: "Big Pickle" }, { id: "small-pickle", name: "Small Pickle" }],
    })) as typeof fetch;

    const models = await discoverProviderModelsDirect(provider({
      id: "opencode",
      name: "OpenCode Zen",
      baseUrl: "https://opencode.ai/zen/v1",
      catalogUrl: undefined,
    }));
    expect(models.every((model) => model.supported)).toBe(true);
  });

  it("normalizes an OpenRouter catalog, extracting context_length, max_completion_tokens, input modalities, and reasoning", async () => {
    globalThis.fetch = vi.fn(async (_input, init) => {
      const headers = init?.headers as Record<string, string>;
      expect(headers["HTTP-Referer"]).toBe("https://rusty.dev");
      expect(headers["X-Title"]).toBe("Rusty");
      expect(headers.Authorization).toBe("Bearer or-key");
      return jsonResponse({
        data: [
          {
            id: "anthropic/claude-3.5-sonnet",
            name: "Anthropic: Claude 3.5 Sonnet",
            context_length: 200000,
            architecture: {
              modality: "text+image->text",
              input_modalities: ["text", "image"],
              output_modalities: ["text"],
            },
            supported_parameters: ["temperature", "reasoning"],
            top_provider: {
              max_completion_tokens: 8192,
            },
          },
          {
            id: "stabilityai/stable-diffusion-xl",
            name: "SDXL",
            context_length: 77,
            architecture: {
              modality: "text->image",
              input_modalities: ["text"],
              output_modalities: ["image"],
            },
          },
        ],
      });
    }) as typeof fetch;

    const models = await discoverProviderModelsDirect(provider({
      id: "openrouter",
      name: "OpenRouter",
      baseUrl: "https://openrouter.ai/api/v1",
      apiKey: "or-key",
      catalogUrl: undefined,
    }));

    expect(models).toHaveLength(2);
    const claude = models.find((m) => m.remoteId === "anthropic/claude-3.5-sonnet")!;
    expect(claude.id).toBe("openrouter/anthropic/claude-3.5-sonnet");
    expect(claude.name).toBe("Anthropic: Claude 3.5 Sonnet");
    expect(claude.contextWindow).toBe(200000);
    expect(claude.maxTokens).toBe(8192);
    expect(claude.input).toEqual(["text", "image"]);
    expect(claude.reasoning).toBe(true);
    expect(claude.supported).toBe(true);

    const sdxl = models.find((m) => m.remoteId === "stabilityai/stable-diffusion-xl")!;
    expect(sdxl.supported).toBe(false);
  });

  it("excludes non-text OpenAI model families (audio/embedding/image/etc.) but keeps gpt-/o-series", async () => {
    globalThis.fetch = vi.fn(async () => jsonResponse({
      data: [{ id: "gpt-4.1" }, { id: "o3" }, { id: "whisper-1" }, { id: "text-embedding-3-large" }],
    })) as typeof fetch;

    const models = await discoverProviderModelsDirect(provider({ id: "openai", name: "OpenAI", baseUrl: "https://api.openai.com/v1", catalogUrl: undefined }));
    const supportedIds = models.filter((m) => m.supported).map((m) => m.remoteId);
    expect(supportedIds).toEqual(expect.arrayContaining(["gpt-4.1", "o3"]));
    expect(supportedIds).not.toContain("whisper-1");
    expect(supportedIds).not.toContain("text-embedding-3-large");
  });

  it("appends limit=1000 to an Anthropic catalog URL with no existing limit param", async () => {
    globalThis.fetch = vi.fn(async (input) => {
      const url = new URL(String(input));
      expect(url.searchParams.get("limit")).toBe("1000");
      return jsonResponse({ data: [] });
    }) as typeof fetch;

    await discoverProviderModelsDirect(provider({ id: "anthropic", name: "Anthropic", baseUrl: "https://api.anthropic.com/v1", catalogUrl: undefined }));
  });

  it("throws a descriptive error for a non-ok HTTP response", async () => {
    globalThis.fetch = vi.fn(async () => new Response("nope", { status: 500, statusText: "Internal Server Error" })) as typeof fetch;
    await expect(discoverProviderModelsDirect(provider())).rejects.toThrow(/500/);
  });

  it("throws for a catalog payload shaped as neither an array nor {data}/{models}", async () => {
    globalThis.fetch = vi.fn(async () => jsonResponse({ unexpected: true })) as typeof fetch;
    await expect(discoverProviderModelsDirect(provider())).rejects.toThrow(/unsupported model-catalog format/);
  });

  it("rejects an invalid provider URL before ever calling fetch", async () => {
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    const custom = provider({ id: "some-custom-provider", name: "Custom", baseUrl: "not a url", catalogUrl: undefined });
    await expect(discoverProviderModelsDirect(custom)).rejects.toThrow(/not valid/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("testProviderConnectionDirect", () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("counts total and supported models from the discovered catalog", async () => {
    globalThis.fetch = vi.fn(async () => jsonResponse([
      { id: "openai/gpt-4.1", capabilities: ["tool-calling"], supported_output_modalities: ["text"] },
      { id: "vendor/embedding", capabilities: ["embeddings"], supported_output_modalities: ["embeddings"] },
    ])) as typeof fetch;

    const result = await testProviderConnectionDirect(provider());
    expect(result).toEqual({ modelCount: 2, supportedModelCount: 1 });
  });
});

describe("fetchProviderQuotaDirect", () => {
  it("reports 'unavailable' with the provider's own known message when authenticated", () => {
    const snapshot = fetchProviderQuotaDirect(provider({ id: "openai", name: "OpenAI", apiKey: "sk-test" }));
    expect(snapshot.state).toBe("unavailable");
    expect(snapshot.message).toMatch(/Admin API key/);
    expect(snapshot.manageUrl).toBe("https://platform.openai.com/usage");
  });

  it("reports 'unavailable' with OpenRouter dashboard link when authenticated", () => {
    const snapshot = fetchProviderQuotaDirect(provider({ id: "openrouter", name: "OpenRouter", apiKey: "sk-test" }));
    expect(snapshot.state).toBe("unavailable");
    expect(snapshot.message).toMatch(/OpenRouter does not expose credits/);
    expect(snapshot.manageUrl).toBe("https://openrouter.ai/settings/keys");
  });

  it("reports 'unauthenticated' when no API key is configured and authType isn't 'none'", () => {
    const snapshot = fetchProviderQuotaDirect(provider({ id: "openai", name: "OpenAI", apiKey: "", authType: "bearer" }));
    expect(snapshot.state).toBe("unauthenticated");
  });

  it("falls back to a generic message for a provider with no known quota details", () => {
    const snapshot = fetchProviderQuotaDirect(provider({ id: "some-custom-provider", name: "Custom", apiKey: "key" }));
    expect(snapshot.state).toBe("unavailable");
    expect(snapshot.message).toMatch(/does not advertise/);
  });
});
