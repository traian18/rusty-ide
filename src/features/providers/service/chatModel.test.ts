import { describe, expect, it } from "vitest";
import type { CustomProvider, ProviderStatus } from "../../../store/types";
import { AUTO_MODEL_ID } from "./intelligentModelSelector";
import { afterProviderDelete, concreteDefaultModel, defaultChatModel, defaultForChats, isAutoSelectionAvailable, isModelUsable, resolveChatModel, type DefaultModelState } from "./chatModel";

const keyed = (id: string, models: string[], apiKey = "key"): CustomProvider => ({
  id, name: id.toUpperCase(), baseUrl: "", apiKey, apiType: "openai-completions", authType: "bearer",
  models: models.map((model) => ({ id: `${id}/${model}`, name: model })),
});
const copilot: CustomProvider = { ...keyed("github-copilot", ["one"], ""), transport: "github-copilot-sdk" };
const status = (kind: ProviderStatus["kind"]) => ({ "github-copilot": { kind } as ProviderStatus });

describe("isModelUsable", () => {
  const providers = [keyed("a", ["x"]), keyed("nokey", ["y"], ""), copilot];

  it("needs the provider to exist, be connected and still list the model", () => {
    expect(isModelUsable("a/x", providers, {})).toBe(true);
    expect(isModelUsable("a/x::reasoning=high", providers, {})).toBe(true);
    expect(isModelUsable("a/gone", providers, {})).toBe(false);
    expect(isModelUsable("nokey/y", providers, {})).toBe(false);
    expect(isModelUsable("deleted/x", providers, {})).toBe(false);
    expect(isModelUsable("", providers, {})).toBe(false);
    expect(isModelUsable(AUTO_MODEL_ID, providers, {})).toBe(false);
  });

  it("counts a signed-in provider as connected until it is known to be signed out", () => {
    expect(isModelUsable("github-copilot/one", providers, status("loading"))).toBe(true);
    expect(isModelUsable("github-copilot/one", providers, status("error"))).toBe(true);
    expect(isModelUsable("github-copilot/one", providers, status("unauthenticated"))).toBe(false);
  });
});

describe("resolveChatModel", () => {
  const providers = [keyed("a", ["x", "z"]), keyed("b", ["y"])];

  it("keeps the chat's own usable choice", () => {
    expect(resolveChatModel("b/y", "a/x", providers, {}, false)).toBe("b/y");
  });

  it("falls back to the default, then to the first connected model", () => {
    expect(resolveChatModel("deleted/m", "a/z", providers, {}, false)).toBe("a/z");
    expect(resolveChatModel(undefined, "deleted/m", providers, {}, false)).toBe("a/x");
    expect(defaultChatModel("", [], {})).toBe("");
  });

  it("keeps AUTO only while intelligent selection can run", () => {
    expect(resolveChatModel(AUTO_MODEL_ID, "a/x", providers, {}, true)).toBe(AUTO_MODEL_ID);
    expect(resolveChatModel(AUTO_MODEL_ID, "a/x", providers, {}, false)).toBe("a/x");
  });
});

describe("afterProviderDelete", () => {
  const shipped = keyed("a", ["x"], "");
  const defaults = [shipped];

  it("removes an added provider, selects another, and moves the default off it", () => {
    const result = afterProviderDelete([keyed("a", ["x"]), keyed("mine", ["m"])], "mine", defaults, "mine", "mine/m", {});
    expect(result.providers.map((provider) => provider.id)).toEqual(["a"]);
    expect(result.selectedProviderId).toBe("a");
    expect(result.defaultModel).toBe("a/x");
  });

  it("resets a built-in provider to how it ships, keeping it selected", () => {
    const result = afterProviderDelete([keyed("a", ["x", "extra"]), keyed("b", ["y"])], "a", defaults, "a", "a/x", {});
    expect(result.providers[0]).toEqual(shipped);
    expect(result.providers[0]).not.toBe(shipped);
    expect(result.selectedProviderId).toBe("a");
    expect(result.defaultModel).toBe("b/y");
  });

  it("leaves another provider's default model alone", () => {
    const result = afterProviderDelete([keyed("a", ["x"]), keyed("mine", ["m"])], "mine", defaults, "a", "a/x", {});
    expect(result.defaultModel).toBe("a/x");
    expect(result.selectedProviderId).toBe("a");
  });
});

describe("AUTO as the default model", () => {
  const openRouterModel = (remoteId: string) => ({ id: `openrouter/${remoteId}`, remoteId, name: remoteId, supported: true });
  const openRouter: CustomProvider = {
    id: "openrouter", name: "OpenRouter", baseUrl: "https://openrouter.ai/api/v1", apiKey: "or-key", apiType: "openai-completions", authType: "bearer",
    models: ["typesafe/jev-1.13", "vendor/light", "vendor/standard", "vendor/heavy"].map(openRouterModel),
  };
  const level = (name: string) => `openrouter:openrouter/vendor/${name}`;
  const state = (overrides: Partial<DefaultModelState> = {}): DefaultModelState => ({
    activeModel: AUTO_MODEL_ID,
    customProviders: [openRouter, keyed("a", ["x"])],
    providerStatus: {},
    activeCustomProviderId: null,
    intelligentModelSelectionSettings: {
      enabled: true, jevModelId: null,
      levelModels: { light: level("light"), standard: level("standard"), heavy: level("heavy") },
    } as DefaultModelState["intelligentModelSelectionSettings"],
    ...overrides,
  });

  it("is available only with JEV connected, selection on and a model for every level", () => {
    expect(isAutoSelectionAvailable(state())).toBe(true);
    const off = state();
    off.intelligentModelSelectionSettings = { ...off.intelligentModelSelectionSettings, enabled: false };
    expect(isAutoSelectionAvailable(off)).toBe(false);
    const missingLevel = state();
    missingLevel.intelligentModelSelectionSettings = { ...missingLevel.intelligentModelSelectionSettings, levelModels: { light: level("light"), standard: null, heavy: level("heavy") } };
    expect(isAutoSelectionAvailable(missingLevel)).toBe(false);
    expect(isAutoSelectionAvailable(state({ customProviders: [{ ...openRouter, apiKey: "" }, keyed("a", ["x"])] }))).toBe(false);
  });

  it("starts chats on AUTO while it can run", () => {
    expect(defaultForChats(state())).toBe(AUTO_MODEL_ID);
    expect(defaultChatModel(defaultForChats(state()), state().customProviders, {}, true)).toBe(AUTO_MODEL_ID);
    expect(resolveChatModel("deleted/m", defaultForChats(state()), state().customProviders, {}, true)).toBe(AUTO_MODEL_ID);
  });

  it("gives features without AUTO the Standard level's model", () => {
    expect(concreteDefaultModel(state())).toBe("openrouter/vendor/standard");
    expect(concreteDefaultModel(state({ activeModel: "a/x" }))).toBe("a/x");
  });

  it("starts chats on that same stand-in while AUTO cannot run, keeping AUTO as the default", () => {
    const off = state();
    off.intelligentModelSelectionSettings = { ...off.intelligentModelSelectionSettings, enabled: false };
    expect(defaultForChats(off)).toBe("openrouter/vendor/standard");
    expect(off.activeModel).toBe(AUTO_MODEL_ID);
  });

  it("falls back to the first connected model when no Standard model resolves", () => {
    const bare = state({ customProviders: [keyed("a", ["x"])] });
    expect(concreteDefaultModel(bare)).toBe("a/x");
  });
});
