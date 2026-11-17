// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useWorkspaceStore } from "../../../store";
import type { CustomProvider, ProviderStatus } from "../../../store/types";

vi.mock("../../providers/service/modelCatalogueService", () => ({
  providerCatalogueSignature: () => "",
  updateModelCatalogue: vi.fn(async () => []),
}));

import { useAgentModel } from "./useAgentModel";
import { AUTO_MODEL_ID } from "../../providers";
import { disposeTabChats, openChat } from "../chats/chatLifecycle";
import { chatRuntime } from "../chats/chatRuntime";
import { useChatStore } from "./chats/chatStore";

const COPILOT = { id: "github-copilot", name: "GitHub Copilot", authType: "environment", models: [{ id: "github-copilot/one", remoteId: "one", name: "One" }] } as unknown as CustomProvider;
const LOCAL = { id: "local", name: "Local", authType: "none", models: [{ id: "local/two", remoteId: "two", name: "Two" }, { id: "local/three", remoteId: "three", name: "Three" }] } as unknown as CustomProvider;

const copilotStatus = (kind: ProviderStatus["kind"]) => ({ "github-copilot": { kind } as ProviderStatus });

const TAB = "model-test-tab";
let chatId = "";
let current: ReturnType<typeof useAgentModel>;

function setChatModel(model: string) {
  chatRuntime(chatId).state.chatModel = model;
  useChatStore.getState().patch(chatId, { model });
}

function Picker() {
  current = useAgentModel(chatId, setChatModel);
  return null;
}

const storedModel = () => useChatStore.getState().chats[chatId]?.model;

describe("useAgentModel", () => {
  let root: Root;

  function renderPicker() {
    act(() => root.render(<Picker />));
  }

  function setStatus(kind: ProviderStatus["kind"]) {
    act(() => useWorkspaceStore.setState({ providerStatus: copilotStatus(kind) }));
  }

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    useWorkspaceStore.setState({
      customProviders: [COPILOT, LOCAL],
      activeCustomProviderId: "github-copilot",
      activeModel: "local/two",
      providerStatus: copilotStatus("ready"),
      secureConfigLoaded: true,
    });
    disposeTabChats(TAB);
    chatId = openChat(TAB);
    root = createRoot(document.createElement("div"));
  });

  afterEach(() => {
    act(() => root.unmount());
    disposeTabChats(TAB);
    vi.unstubAllGlobals();
  });

  it("starts a new chat on the default model", () => {
    expect(storedModel()).toBe("local/two");
    renderPicker();
    expect(current.selectedModel).toBe("local/two");
  });

  it("keeps the chat's own choice, and leaves the default alone", () => {
    renderPicker();
    act(() => current.selectModel("github-copilot/one"));
    expect(current.selectedModel).toBe("github-copilot/one");
    expect(storedModel()).toBe("github-copilot/one");
    expect(useWorkspaceStore.getState().activeModel).toBe("local/two");
  });

  it("gives each chat its own model", () => {
    renderPicker();
    act(() => current.selectModel("local/three"));
    const first = chatId;
    chatId = openChat(TAB);
    renderPicker();
    expect(current.selectedModel).toBe("local/two");
    expect(useChatStore.getState().chats[first]?.model).toBe("local/three");
  });

  it("moves a chat to the default when its provider signs out, and keeps it there", () => {
    setChatModel("github-copilot/one");
    renderPicker();

    setStatus("unauthenticated");

    expect(current.selectedModel).toBe("local/two");
    expect(storedModel()).toBe("local/two");
    expect(current.options.map((option) => option.id)).toEqual(["local/two", "local/three"]);
  });

  it("moves a chat to the default when its provider is deleted", () => {
    setChatModel("github-copilot/one");
    renderPicker();

    act(() => useWorkspaceStore.setState({ customProviders: [LOCAL] }));

    expect(current.selectedModel).toBe("local/two");
    expect(storedModel()).toBe("local/two");
  });

  it("moves a chat to the default when its model left the catalogue", () => {
    setChatModel("local/retired");
    renderPicker();
    expect(current.selectedModel).toBe("local/two");
  });

  it("keeps the choice through a failed status check, which is not a sign-out", () => {
    setChatModel("github-copilot/one");
    renderPicker();

    setStatus("error");

    expect(current.selectedModel).toBe("github-copilot/one");
  });

  it("falls back to the first connected model when the default cannot run either", () => {
    useWorkspaceStore.setState({ activeModel: "github-copilot/one" });
    setChatModel("github-copilot/one");
    renderPicker();

    setStatus("unauthenticated");

    expect(current.selectedModel).toBe("local/two");
  });

  it("starts a new chat on AUTO when AUTO is the default and can run", () => {
    const openRouterModel = (remoteId: string) => ({ id: `openrouter/${remoteId}`, remoteId, name: remoteId, supported: true });
    const openRouter = {
      id: "openrouter", name: "OpenRouter", apiKey: "or-key", authType: "bearer",
      models: ["typesafe/jev-1.13", "vendor/light", "vendor/standard", "vendor/heavy"].map(openRouterModel),
    } as unknown as CustomProvider;
    const level = (name: string) => `openrouter:openrouter/vendor/${name}`;
    const previous = useWorkspaceStore.getState().intelligentModelSelectionSettings;
    useWorkspaceStore.setState({
      customProviders: [openRouter, LOCAL],
      activeModel: AUTO_MODEL_ID,
      intelligentModelSelectionSettings: { ...previous, enabled: true, jevModelId: null, levelModels: { light: level("light"), standard: level("standard"), heavy: level("heavy") } },
    });
    try {
      chatId = openChat(TAB);
      renderPicker();
      expect(storedModel()).toBe(AUTO_MODEL_ID);
      expect(current.selectedModel).toBe(AUTO_MODEL_ID);
    } finally {
      useWorkspaceStore.setState({ intelligentModelSelectionSettings: previous });
    }
  });

  it("changes nothing before the saved configuration has loaded", () => {
    useWorkspaceStore.setState({ secureConfigLoaded: false, customProviders: [LOCAL] });
    setChatModel("github-copilot/one");
    renderPicker();
    expect(storedModel()).toBe("github-copilot/one");
  });
});
