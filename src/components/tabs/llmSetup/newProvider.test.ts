import { describe, expect, it, vi } from "vitest";
import type { CustomProvider } from "../../../store";
import {
  buildNewProvider,
  checkNewProvider,
  EMPTY_NEW_PROVIDER_DRAFT,
  SERVICE_PRESET_OPTIONS,
  uniqueProviderId,
  withPreset,
  type NewProviderDraft,
} from "./newProvider";

const draft = (changes: Partial<NewProviderDraft>): NewProviderDraft => ({ ...EMPTY_NEW_PROVIDER_DRAFT, ...changes });
const existing = (...ids: string[]) => ids.map((id) => ({ id }) as CustomProvider);

describe("newProvider", () => {
  it("offers the presets in menu order with their labels", () => {
    expect(SERVICE_PRESET_OPTIONS.map((option) => option.name)).toEqual([
      "OpenAI-Compatible API", "Ollama", "vLLM", "OpenRouter", "OpenCode Zen", "OpenAI", "Mistral",
    ]);
  });

  it("fills a preset's default name and URL", () => {
    expect(withPreset(draft({ apiKey: "kept" }), "mistral")).toMatchObject({
      preset: "mistral",
      name: "Mistral",
      url: "https://api.mistral.ai/v1",
      apiKey: "kept",
    });
  });

  it("checks the name, then the URL, then the configuration", () => {
    expect(checkNewProvider(draft({ name: " ", url: "x" }))).toMatchObject({ ok: false, title: "Display name required" });
    expect(checkNewProvider(draft({ name: "Lab", url: " " }))).toMatchObject({ ok: false, title: "Base URL required" });
    expect(checkNewProvider(draft({ name: "Lab", url: "not a url" }))).toMatchObject({ ok: false, title: "Configuration invalid" });
  });

  it("requires a key for presets that authenticate with a bearer token", () => {
    const check = checkNewProvider(draft({ preset: "openrouter", name: "OR", url: "https://openrouter.ai/api/v1" }));
    expect(check).toEqual({ ok: false, title: "Configuration invalid", message: "API key is required for this service profile" });
    expect(checkNewProvider(draft({ preset: "openrouter", name: "OR", url: "https://openrouter.ai/api/v1", apiKey: "sk" })).ok).toBe(true);
  });

  it("passes validation warnings through", () => {
    const check = checkNewProvider(draft({ name: "Lab", url: "http://192.168.1.5:8000/v1" }));
    expect(check.ok && check.warnings).toEqual([expect.stringContaining("unencrypted HTTP")]);
  });

  it("derives a unique id from the display name", () => {
    expect(uniqueProviderId("My  Ollama!", [])).toBe("my-ollama");
    expect(uniqueProviderId("Ollama", existing("ollama", "ollama-1"))).toBe("ollama-2");
  });

  it("falls back to a timestamped id when the name has no letters or digits", () => {
    vi.spyOn(Date, "now").mockReturnValue(42);
    expect(uniqueProviderId("!!!", [])).toBe("provider-42");
  });

  it("builds the provider from its preset, with tools enabled", () => {
    const provider = buildNewProvider(draft({ preset: "openai", name: " Work ", url: " https://api.openai.com/v1 ", apiKey: "sk", model: "o4" }), []);
    expect(provider).toEqual({
      id: "work",
      name: "Work",
      baseUrl: "https://api.openai.com/v1",
      apiKey: "sk",
      apiType: "openai-responses",
      authType: "bearer",
      profile: "openai-responses",
      capabilities: { tools: "enabled" },
      models: [{ id: "work/o4", remoteId: "o4", name: "o4", apiType: "openai-responses", baseUrl: "https://api.openai.com/v1", supported: true }],
    });
  });

  it("leaves models empty when no model id is given", () => {
    expect(buildNewProvider(draft({ name: "Lab", url: "http://localhost:1/v1", model: "  " }), []).models).toEqual([]);
  });
});
