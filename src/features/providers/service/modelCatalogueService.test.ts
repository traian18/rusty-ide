import { beforeEach, describe, expect, it, vi } from "vitest";
import { useWorkspaceStore } from "../../../store";
import type { CustomProvider, ProviderStatus } from "../../../store/types";

vi.mock("../../../harness/HybridControlPlane", () => ({
  hybridControlPlane: { discoverModels: vi.fn() },
}));

import { hybridControlPlane } from "../../../harness/HybridControlPlane";
import { updateModelCatalogue } from "./modelCatalogueService";

const COPILOT = {
  id: "github-copilot",
  name: "GitHub Copilot",
  baseUrl: "",
  apiKey: "",
  apiType: "copilot-sdk",
  authType: "environment",
  models: [],
} as unknown as CustomProvider;
const MODEL = { id: "github-copilot/gpt-5", remoteId: "gpt-5", name: "GPT-5" };

function setStatus(kind: ProviderStatus["kind"]) {
  useWorkspaceStore.setState({ providerStatus: { "github-copilot": { kind } } });
}

describe("updateModelCatalogue", () => {
  beforeEach(() => {
    useWorkspaceStore.setState({ customProviders: [COPILOT] });
    setStatus("ready");
    vi.mocked(hybridControlPlane.discoverModels).mockReset();
  });

  it("stores the models of a signed-in provider", async () => {
    vi.mocked(hybridControlPlane.discoverModels).mockResolvedValue([MODEL] as never);

    await updateModelCatalogue(COPILOT);

    expect(useWorkspaceStore.getState().customProviders[0].models).toEqual([MODEL]);
  });

  it("drops an answer that arrives after the user signed out", async () => {
    let answer!: (models: unknown[]) => void;
    vi.mocked(hybridControlPlane.discoverModels).mockReturnValue(new Promise((resolve) => { answer = resolve as never; }));
    const update = updateModelCatalogue(COPILOT);

    setStatus("unauthenticated");
    answer([MODEL]);
    await update;

    expect(useWorkspaceStore.getState().customProviders[0].models).toEqual([]);
    expect(useWorkspaceStore.getState().customProviders[0].modelsFetchedAt).toBeUndefined();
  });
});
