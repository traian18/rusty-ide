import { describe, expect, it } from "vitest";

import type { CustomProvider } from "../../store/types";
import { PROVIDER_ROUTING_PROFILES, resolveProviderRoute } from "./modelRouting";

function opencodeProvider(overrides: Partial<CustomProvider> = {}): CustomProvider {
  return {
    id: "opencode",
    name: "OpenCode Zen",
    baseUrl: "https://opencode.ai/zen/v1",
    apiKey: "sk-zen-test",
    apiType: "openai-completions",
    models: [],
    ...overrides,
  };
}

describe("resolveProviderRoute", () => {
  it("routes a Claude-family OpenCode Zen model to the anthropic integration", () => {
    const route = resolveProviderRoute(opencodeProvider(), "opencode/claude-sonnet-4-5");
    expect(route).toEqual({
      integration: "anthropic",
      integration_config: {
        api_key: "sk-zen-test",
        base_url: "https://opencode.ai/zen",
        default_model: "claude-sonnet-4-5",
        default_max_tokens: 8192,
      },
      resolvedModelId: "claude-sonnet-4-5",
    });
  });

  it("routes haiku, qwen and union-alpha model ids to the anthropic family too", () => {
    expect(resolveProviderRoute(opencodeProvider(), "opencode/haiku-4-5")?.integration).toBe("anthropic");
    expect(resolveProviderRoute(opencodeProvider(), "opencode/qwen3.6-plus")?.integration).toBe("anthropic");
    expect(resolveProviderRoute(opencodeProvider(), "opencode/union-alpha")?.integration).toBe("anthropic");
  });

  it("routes a GPT-family OpenCode Zen model to the openai-responses integration", () => {
    const route = resolveProviderRoute(opencodeProvider(), "opencode/gpt-5.1");
    expect(route).toEqual({
      integration: "openai-responses",
      integration_config: {
        api_key: "sk-zen-test",
        base_url: "https://opencode.ai/zen/v1",
        default_model: "gpt-5.1",
      },
      resolvedModelId: "gpt-5.1",
    });
  });

  it("routes grok and muse-spark model ids to the openai-responses family too", () => {
    expect(resolveProviderRoute(opencodeProvider(), "opencode/grok-4")?.integration).toBe("openai-responses");
    expect(resolveProviderRoute(opencodeProvider(), "opencode/muse-spark-1")?.integration).toBe("openai-responses");
  });

  it("routes everything else to the openai-compatible catch-all", () => {
    const route = resolveProviderRoute(opencodeProvider(), "opencode/big-pickle");
    expect(route).toEqual({
      integration: "openai-compatible",
      integration_config: {
        api_key: "sk-zen-test",
        base_url: "https://opencode.ai/zen/v1",
        model: "big-pickle",
        supports_reasoning: true,
      },
      resolvedModelId: "big-pickle",
    });
    expect(resolveProviderRoute(opencodeProvider(), "opencode/deepseek-v3")?.integration).toBe("openai-compatible");
    expect(resolveProviderRoute(opencodeProvider(), "opencode/glm-4.6")?.integration).toBe("openai-compatible");
  });

  it("strips a reasoning-effort suffix before matching the model family", () => {
    const route = resolveProviderRoute(opencodeProvider(), "opencode/gpt-5.1::reasoning=high");
    expect(route?.integration).toBe("openai-responses");
    expect(route?.integration_config.default_model).toBe("gpt-5.1");
  });

  it("routes opencode-go through its own /go base paths", () => {
    const provider = opencodeProvider({ id: "opencode-go", baseUrl: "https://opencode.ai/zen/go/v1" });
    const claudeRoute = resolveProviderRoute(provider, "opencode-go/claude-sonnet-4-5");
    expect(claudeRoute?.integration_config.base_url).toBe("https://opencode.ai/zen/go");
    const chatRoute = resolveProviderRoute(provider, "opencode-go/big-pickle");
    expect(chatRoute?.integration_config.base_url).toBe("https://opencode.ai/zen/go/v1");
  });

  it("routes an OpenRouter model to the openai-compatible integration with stripped remote model id", () => {
    const provider: CustomProvider = {
      id: "openrouter",
      name: "OpenRouter",
      baseUrl: "https://openrouter.ai/api/v1",
      apiKey: "sk-or-test",
      apiType: "openai-completions",
      models: [],
    };
    const route = resolveProviderRoute(provider, "openrouter/anthropic/claude-3.5-sonnet");
    expect(route).toEqual({
      integration: "openai-compatible",
      integration_config: {
        api_key: "sk-or-test",
        base_url: "https://openrouter.ai/api/v1",
        model: "anthropic/claude-3.5-sonnet",
        supports_reasoning: true,
      },
      resolvedModelId: "anthropic/claude-3.5-sonnet",
    });
  });

  it("routes OpenRouter reasoning variant stripping the suffix", () => {
    const provider: CustomProvider = {
      id: "openrouter",
      name: "OpenRouter",
      baseUrl: "https://openrouter.ai/api/v1",
      apiKey: "sk-or-test",
      apiType: "openai-completions",
      models: [],
    };
    const route = resolveProviderRoute(provider, "openrouter/deepseek/deepseek-r1::reasoning=high");
    expect(route?.integration).toBe("openai-compatible");
    expect(route?.resolvedModelId).toBe("deepseek/deepseek-r1");
    expect(route?.integration_config.model).toBe("deepseek/deepseek-r1");
  });

  it("returns undefined for a provider with no routing profile, falling through to today's host behavior", () => {
    const provider = opencodeProvider({ id: "some-other-provider" });
    expect(resolveProviderRoute(provider, "some-other-provider/some-model")).toBeUndefined();
  });

  it("returns undefined when the provider has no API key configured yet", () => {
    const provider = opencodeProvider({ apiKey: "" });
    expect(resolveProviderRoute(provider, "opencode/claude-sonnet-4-5")).toBeUndefined();
  });

  it("does not yet register a Gemini-family route -- gated pending live auth verification", () => {
    for (const profile of Object.values(PROVIDER_ROUTING_PROFILES)) {
      expect(profile.routes.some((route) => route.matches("gemini-3-flash") && route.integration === "gemini")).toBe(
        false,
      );
    }
  });
});
