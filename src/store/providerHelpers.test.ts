import { describe, expect, it } from "vitest";
import {
  isClaudeCodeProvider,
  isCodexProvider,
  isCopilotProvider,
  isManagedAuthProvider,
  normalizeStoredProvider,
  parseModelReference,
  resolveProviderModel,
  selectableModelProviders,
} from "./providerHelpers";
import type { CustomProvider, ProviderStatus } from "./types";
import type { ProviderStatusKind } from "../integrations/registryTypes";

/**
 * These predicates used to be duplicated verbatim in LlmSetupTab.tsx and
 * ProviderList.tsx (REFACTOR_PLAN.md PR 3b commit 10). One copy here,
 * pinned by id and by transport -- both are recognized independently,
 * since normalizeStoredProvider (providerHelpers.ts) can migrate an id
 * without necessarily touching transport, and vice versa.
 */
function provider(overrides: Partial<CustomProvider>): CustomProvider {
  return {
    id: "some-id",
    name: "Some Provider",
    baseUrl: "",
    apiKey: "",
    apiType: "openai-completions",
    models: [],
    ...overrides,
  };
}

describe("isCopilotProvider", () => {
  it("recognizes by id", () => {
    expect(isCopilotProvider(provider({ id: "github-copilot" }))).toBe(true);
  });
  it("recognizes by transport", () => {
    expect(isCopilotProvider(provider({ id: "renamed", transport: "github-copilot-sdk" }))).toBe(true);
  });
  it("is false for an unrelated provider", () => {
    expect(isCopilotProvider(provider({ id: "openai" }))).toBe(false);
  });
});

describe("isCodexProvider", () => {
  it("recognizes by id", () => {
    expect(isCodexProvider(provider({ id: "openai-codex" }))).toBe(true);
  });
  it("recognizes by transport", () => {
    expect(isCodexProvider(provider({ id: "renamed", transport: "openai-codex-app-server" }))).toBe(true);
  });
  it("is false for an unrelated provider", () => {
    expect(isCodexProvider(provider({ id: "openai" }))).toBe(false);
  });
});

describe("isClaudeCodeProvider", () => {
  it("recognizes by id", () => {
    expect(isClaudeCodeProvider(provider({ id: "anthropic-claude-code" }))).toBe(true);
  });
  it("recognizes by transport", () => {
    expect(isClaudeCodeProvider(provider({ id: "renamed", transport: "anthropic-claude-agent-sdk" }))).toBe(true);
  });
  it("is false for an unrelated provider", () => {
    expect(isClaudeCodeProvider(provider({ id: "anthropic" }))).toBe(false);
  });
});

describe("isManagedAuthProvider", () => {
  it("is true for any of the three managed providers", () => {
    expect(isManagedAuthProvider(provider({ id: "github-copilot" }))).toBe(true);
    expect(isManagedAuthProvider(provider({ id: "openai-codex" }))).toBe(true);
    expect(isManagedAuthProvider(provider({ id: "anthropic-claude-code" }))).toBe(true);
  });

  it("is false for a regular provider", () => {
    expect(isManagedAuthProvider(provider({ id: "opencode" }))).toBe(false);
  });
});

describe("parseModelReference", () => {
  it("returns the reference unchanged when there is no reasoning-effort suffix", () => {
    expect(parseModelReference("opencode/big-pickle")).toEqual({ baseReference: "opencode/big-pickle" });
  });

  it("splits off a valid reasoning-effort suffix", () => {
    expect(parseModelReference("opencode/big-pickle::reasoning=minimal")).toEqual({
      baseReference: "opencode/big-pickle",
      reasoningEffort: "minimal",
    });
  });

  it("treats an unrecognized suffix value as not a reasoning-effort suffix at all", () => {
    expect(parseModelReference("opencode/big-pickle::reasoning=extreme")).toEqual({
      baseReference: "opencode/big-pickle::reasoning=extreme",
    });
  });
});

describe("resolveProviderModel", () => {
  it("strips the provider-id prefix when no configured model matches", () => {
    const p = provider({ id: "opencode", models: [] });
    expect(resolveProviderModel(p, "opencode/big-pickle")).toEqual({ modelId: "big-pickle" });
  });

  it("strips both the prefix and the reasoning-effort suffix together", () => {
    const p = provider({ id: "opencode", models: [] });
    expect(resolveProviderModel(p, "opencode/big-pickle::reasoning=minimal")).toEqual({
      modelId: "big-pickle",
      reasoningEffort: "minimal",
    });
  });

  it("prefers a configured model's own remoteId over stripping the prefix itself", () => {
    const p = provider({
      id: "opencode",
      models: [{ id: "opencode/big-pickle", name: "Big Pickle", remoteId: "vendor/big-pickle-v2" }],
    });
    expect(resolveProviderModel(p, "opencode/big-pickle")).toEqual({ modelId: "vendor/big-pickle-v2" });
  });

  it("falls back to a matching model's own reasoningEffort when the reference carries none", () => {
    const p = provider({
      id: "opencode",
      models: [{ id: "opencode/o3-mini", name: "o3-mini", reasoningEffort: "high" }],
    });
    expect(resolveProviderModel(p, "opencode/o3-mini")).toEqual({
      modelId: "o3-mini",
      reasoningEffort: "high",
    });
  });

  it("leaves a reference with no provider prefix and no configured match untouched", () => {
    const p = provider({ id: "opencode", models: [] });
    expect(resolveProviderModel(p, "llama3")).toEqual({ modelId: "llama3" });
  });

  it("resolves an OpenRouter model id with a vendor prefix slash correctly", () => {
    const p = provider({ id: "openrouter", models: [] });
    expect(resolveProviderModel(p, "openrouter/anthropic/claude-3.5-sonnet")).toEqual({
      modelId: "anthropic/claude-3.5-sonnet",
    });

    const pWithModel = provider({
      id: "openrouter",
      models: [{
        id: "openrouter/anthropic/claude-3.5-sonnet",
        name: "Claude 3.5 Sonnet",
        remoteId: "anthropic/claude-3.5-sonnet",
      }],
    });
    expect(resolveProviderModel(pWithModel, "openrouter/anthropic/claude-3.5-sonnet")).toEqual({
      modelId: "anthropic/claude-3.5-sonnet",
    });
  });
});

describe("normalizeStoredProvider", () => {
  it("infers bearer authType for openrouter", () => {
    const normalized = normalizeStoredProvider(provider({ id: "openrouter", authType: undefined as any }));
    expect(normalized.authType).toBe("bearer");
  });
});

describe("selectableModelProviders: registry-aware gating (REFACTOR_PLAN.md PR 3c)", () => {
  function statusOf(kind: ProviderStatusKind): Record<string, ProviderStatus> {
    return { "github-copilot": { kind } };
  }

  const managed = provider({ id: "github-copilot", authType: "environment" });
  const regularWithKey = provider({ id: "custom-ollama", authType: "bearer", apiKey: "sk-test" });
  const regularNoKey = provider({ id: "custom-ollama", authType: "bearer", apiKey: "" });
  const regularNoAuth = provider({ id: "custom-ollama", authType: "none" });

  it("includes a managed provider only when its status is 'ready'", () => {
    expect(selectableModelProviders([managed], statusOf("ready"), null)).toEqual([managed]);
  });

  it.each(["unknown", "loading", "unauthenticated", "error"] as const)(
    "excludes a managed provider when its status is '%s'",
    (kind) => {
      expect(selectableModelProviders([managed], statusOf(kind), null)).toEqual([]);
    },
  );

  it("includes a managed provider excluded by status if it is the currently-selected provider (escape hatch)", () => {
    expect(selectableModelProviders([managed], statusOf("error"), "github-copilot")).toEqual([managed]);
  });

  it("includes a regular provider with authType 'none' even with no providerStatus entry at all", () => {
    // The asymmetry this test guards: providerCoordinator.ts only ever
    // polls the three managed provider ids, so a regular provider's
    // registry entry is permanently absent (reads back {kind: "unknown"}
    // via providerStatusOrUnknown) -- it must never be gated on status.
    expect(selectableModelProviders([regularNoAuth], {}, null)).toEqual([regularNoAuth]);
  });

  it("includes a regular provider with a non-empty apiKey, no providerStatus entry", () => {
    expect(selectableModelProviders([regularWithKey], {}, null)).toEqual([regularWithKey]);
  });

  it("excludes a regular provider with authType requiring a key but none set -- today's rule, unchanged", () => {
    expect(selectableModelProviders([regularNoKey], {}, null)).toEqual([]);
  });
});
