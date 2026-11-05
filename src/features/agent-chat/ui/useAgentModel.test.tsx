// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useWorkspaceStore } from "../../../store";
import { AGENT_MODEL_SELECTION_STORAGE_KEY } from "../../providers";
import type { CustomProvider, ProviderStatus } from "../../../store/types";

vi.mock("../../providers/service/modelCatalogueService", () => ({
  providerCatalogueSignature: () => "",
  updateModelCatalogue: vi.fn(async () => []),
}));

import { useAgentModel } from "./useAgentModel";

const COPILOT = { id: "github-copilot", name: "GitHub Copilot", authType: "environment", models: [{ id: "github-copilot/one", remoteId: "one", name: "One" }] } as unknown as CustomProvider;
const LOCAL = { id: "local", name: "Local", authType: "none", models: [{ id: "local/two", remoteId: "two", name: "Two" }] } as unknown as CustomProvider;

const copilotStatus = (kind: ProviderStatus["kind"]) => ({ "github-copilot": { kind } as ProviderStatus });

let current: ReturnType<typeof useAgentModel>;
function Picker() {
  current = useAgentModel();
  return null;
}

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
    localStorage.setItem(AGENT_MODEL_SELECTION_STORAGE_KEY, "github-copilot/one");
    useWorkspaceStore.setState({
      customProviders: [COPILOT, LOCAL],
      activeCustomProviderId: "github-copilot",
      activeModel: "",
      providerStatus: copilotStatus("ready"),
    });
    root = createRoot(document.createElement("div"));
  });

  afterEach(() => {
    act(() => root.unmount());
    localStorage.removeItem(AGENT_MODEL_SELECTION_STORAGE_KEY);
    vi.unstubAllGlobals();
  });

  it("keeps the saved choice while its provider is signed in", () => {
    renderPicker();
    expect(current.selectedModel).toBe("github-copilot/one");
  });

  it("moves off a model of a provider that signs out, leaving no unavailable entry", () => {
    renderPicker();

    setStatus("unauthenticated");

    expect(current.selectedModel).toBe("local/two");
    expect(current.options.map((option) => option.id)).toEqual(["local/two"]);
    expect(localStorage.getItem(AGENT_MODEL_SELECTION_STORAGE_KEY)).toBe("local/two");
  });

  it("does not go back to a default model that is signed out too", () => {
    useWorkspaceStore.setState({ activeModel: "github-copilot/one" });
    renderPicker();

    setStatus("unauthenticated");

    expect(current.selectedModel).toBe("local/two");
  });

  it("keeps the choice through a failed status check, which is not a sign-out", () => {
    renderPicker();

    setStatus("error");

    expect(current.selectedModel).toBe("github-copilot/one");
  });

  it("still marks a model that merely left the catalogue as unavailable", () => {
    localStorage.setItem(AGENT_MODEL_SELECTION_STORAGE_KEY, "local/retired");
    renderPicker();

    expect(current.selectedModel).toBe("local/retired");
    expect(current.options).toContainEqual({ id: "local/retired", name: "local/retired (unavailable)" });
  });
});
