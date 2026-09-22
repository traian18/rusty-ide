import { describe, expect, it } from "vitest";

import type { CustomProvider } from "../../store/types";
import { mapProviderToIntegration, maxTokensFor } from "./providerMapping";

function provider(overrides: Partial<CustomProvider>): CustomProvider {
  return {
    id: "p1",
    name: "Test Provider",
    baseUrl: "https://example.test/v1",
    apiKey: "sk-test",
    apiType: "openai-completions",
    models: [],
    ...overrides,
  };
}

describe("mapProviderToIntegration", () => {
  it("maps any HTTP-transport provider to the host-routed backend, with an empty integration_config", () => {
    const result = mapProviderToIntegration(provider({ apiType: "openai-completions" }), "llama3");
    expect(result).toEqual({ supported: true, integration: "host", integration_config: {}, reasoningEffort: undefined });
  });

  it("maps anthropic-messages to host too -- provider identity is no longer decided here", () => {
    const result = mapProviderToIntegration(
      provider({ apiType: "anthropic-messages", baseUrl: "https://api.anthropic.com" }),
      "claude-opus-4-20250514",
    );
    expect(result).toEqual({ supported: true, integration: "host", integration_config: {}, reasoningEffort: undefined });
  });

  it("maps openai-responses to host too", () => {
    const result = mapProviderToIntegration(provider({ apiType: "openai-responses" }), "gpt-4.1");
    expect(result).toEqual({ supported: true, integration: "host", integration_config: {}, reasoningEffort: undefined });
  });

  it("now supports apiTypes that had no direct rusty-core integration before (e.g. google-generative-ai)", () => {
    // Milestone B's direct-integration mapping only covered three apiTypes;
    // host-routing resolves provider identity on the IDE side instead, so
    // every apiType the sidecar can already reach becomes usable here too.
    const result = mapProviderToIntegration(provider({ apiType: "google-generative-ai" }), "gemini-2.5-pro");
    expect(result).toEqual({ supported: true, integration: "host", integration_config: {}, reasoningEffort: undefined });
  });

  it("maps the Claude Code managed transport to rusty-core's own claude-code integration", () => {
    const result = mapProviderToIntegration(
      provider({ apiType: "anthropic-messages", transport: "anthropic-claude-agent-sdk" }),
      "claude-opus-4-20250514",
    );
    expect(result).toEqual({
      supported: true,
      integration: "claude-code",
      integration_config: {},
      reasoningEffort: undefined,
      model: "claude-opus-4-20250514",
    });
  });

  it("maps the Codex managed transport to rusty-core's own codex integration", () => {
    const result = mapProviderToIntegration(
      provider({ apiType: "openai-responses", transport: "openai-codex-app-server" }),
      "gpt-5-codex",
    );
    expect(result).toEqual({ supported: true, integration: "codex", integration_config: {}, reasoningEffort: undefined, model: "gpt-5-codex" });
  });

  it("maps the GitHub Copilot managed transport to rusty-core's own github-copilot integration", () => {
    const result = mapProviderToIntegration(
      provider({ apiType: "openai-completions", transport: "github-copilot-sdk" }),
      "auto",
    );
    expect(result).toEqual({ supported: true, integration: "github-copilot", integration_config: {}, reasoningEffort: undefined, model: "auto" });
  });

  it("reports unsupported for a genuinely unrecognized transport", () => {
    const result = mapProviderToIntegration(
      provider({ apiType: "anthropic-messages", transport: "some-future-sdk" as CustomProvider["transport"] }),
      "some-model",
    );
    expect(result).toEqual({
      supported: false,
      reason: 'managed transport "some-future-sdk" is not supported on core yet',
    });
  });

  it("treats an explicit http transport the same as no transport", () => {
    const result = mapProviderToIntegration(provider({ apiType: "openai-responses", transport: "http" }), "gpt-4.1");
    expect(result.supported).toBe(true);
  });

  it("extracts a reasoning-effort suffix from the model reference, clamped to rusty-core's three levels", () => {
    const cases: Array<[string, string]> = [
      ["minimal", "low"],
      ["low", "low"],
      ["medium", "medium"],
      ["high", "high"],
      ["xhigh", "high"],
    ];
    for (const [uiEffort, coreEffort] of cases) {
      const result = mapProviderToIntegration(provider({ apiType: "openai-completions" }), `m::reasoning=${uiEffort}`);
      expect(result).toMatchObject({ reasoningEffort: coreEffort });
    }
  });

  it("leaves reasoningEffort undefined when the model reference carries no suffix", () => {
    const result = mapProviderToIntegration(provider({ apiType: "openai-completions" }), "big-pickle");
    expect(result).toMatchObject({ reasoningEffort: undefined });
  });

  it("returns the resolved (stripped) model id for a modelRouting.ts-routed provider, not the raw reference", () => {
    const result = mapProviderToIntegration(
      provider({ id: "opencode", baseUrl: "https://opencode.ai/zen/v1", apiType: "openai-completions" }),
      "opencode/claude-haiku-4-5::reasoning=minimal",
    );
    expect(result).toMatchObject({
      supported: true,
      integration: "anthropic",
      model: "claude-haiku-4-5",
      reasoningEffort: "low",
    });
  });

  it("leaves model undefined for the host fallback -- resolved later, IDE-side", () => {
    const result = mapProviderToIntegration(provider({ apiType: "openai-completions" }), "llama3");
    expect(result).toMatchObject({ supported: true, integration: "host" });
    expect((result as { model?: string }).model).toBeUndefined();
  });

  it("strips the provider prefix and effort suffix before passing a managed model to core", () => {
    const result = mapProviderToIntegration(
      provider({ id: "anthropic-claude-code", apiType: "anthropic-messages", transport: "anthropic-claude-agent-sdk" }),
      "anthropic-claude-code/sonnet::reasoning=high",
    );
    expect(result).toMatchObject({ integration: "claude-code", model: "sonnet", reasoningEffort: "high" });
  });
});

describe("maxTokensFor", () => {
  it("gives OpenCode Zen (and its opencode-go twin) the 8192 ceiling its gateway is documented to require", () => {
    expect(maxTokensFor(provider({ id: "opencode" }))).toBe(8192);
    expect(maxTokensFor(provider({ id: "opencode-go" }))).toBe(8192);
  });

  it("gives every other provider a realistic ceiling instead of OpenCode Zen's one-off constraint", () => {
    expect(maxTokensFor(provider({ id: "openrouter" }))).toBe(64_000);
    expect(maxTokensFor(provider({ id: "p1" }))).toBe(64_000);
    expect(maxTokensFor(provider({ id: "anthropic-claude-code", transport: "anthropic-claude-agent-sdk" }))).toBe(64_000);
  });
});
