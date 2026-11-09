import { describe, expect, it } from "vitest";
import { lookupModelLimits, type LimitsEntries } from "./lookup";

const entries: LimitsEntries = {
  "gpt-6-luna": [922_000, 128_000, "openai"],
  "chatgpt/gpt-6-luna": [500_000, 128_000, "chatgpt"],
  "github_copilot/gpt-6-luna": [272_000, null, "github_copilot"],
  "claude-opus-5-5": [1_000_000, 128_000, "anthropic"],
  "openrouter/anthropic/claude-opus-5-5": [900_000, 64_000, "openrouter"],
  "mistral/mistral-large-latest": [262_144, 262_144, "mistral"],
};

describe("lookupModelLimits", () => {
  it("prefers the provider's own entry over the maker's", () => {
    expect(lookupModelLimits(entries, "openai-codex", "gpt-6-luna")?.contextWindow).toBe(500_000);
    expect(lookupModelLimits(entries, "github-copilot", "gpt-6-luna")).toMatchObject({ contextWindow: 272_000, key: "github_copilot/gpt-6-luna" });
    expect(lookupModelLimits(entries, "github-copilot", "gpt-6-luna")?.maxOutputTokens).toBeUndefined();
    expect(lookupModelLimits(entries, "openai", "gpt-6-luna")).toMatchObject({ contextWindow: 922_000, maxOutputTokens: 128_000 });
    expect(lookupModelLimits(entries, "openrouter", "anthropic/claude-opus-5-5")?.contextWindow).toBe(900_000);
  });

  it("falls back to the maker's entry for other providers and routed ids", () => {
    expect(lookupModelLimits(entries, "my-proxy", "claude-opus-5-5")?.contextWindow).toBe(1_000_000);
    expect(lookupModelLimits(entries, "my-proxy", "anthropic/Claude-Opus-5-5")?.contextWindow).toBe(1_000_000);
    expect(lookupModelLimits(entries, undefined, "mistral-large-latest")?.contextWindow).toBe(262_144);
  });

  it("never guesses for local servers or unknown models", () => {
    expect(lookupModelLimits(entries, "ollama", "gpt-6-luna")).toBeUndefined();
    expect(lookupModelLimits(entries, "openai", "not-a-model")).toBeUndefined();
    expect(lookupModelLimits(entries, "openai", " ")).toBeUndefined();
  });
});
