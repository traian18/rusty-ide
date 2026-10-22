import { describe, expect, it } from "vitest";
import type { CustomProvider } from "../../../store";
import {
  checkFailed,
  checkSucceeded,
  mergeDiscoveredModels,
  modelsRefreshedMessage,
  replacementActiveModel,
} from "./providerChecks";

describe("providerChecks", () => {
  it("keeps earlier model fields, matching by id and then by remote id", () => {
    const previous = [
      { id: "p/a", name: "a", contextWindow: 1000 },
      { id: "p/old-b", name: "b", remoteId: "b", maxTokens: 50 },
    ];
    const merged = mergeDiscoveredModels([{ id: "p/a", name: "A" }, { id: "p/b", name: "B", remoteId: "b" }, { id: "p/c", name: "C" }], previous);
    expect(merged).toEqual([
      { id: "p/a", name: "A", contextWindow: 1000 },
      { id: "p/b", name: "B", remoteId: "b", maxTokens: 50 },
      { id: "p/c", name: "C" },
    ]);
  });

  it("stamps check results without dropping the other check", () => {
    const provider = { executionStatus: { catalog: { status: "success" } } } as CustomProvider;
    expect(checkFailed(provider, "inference", "refused")).toEqual({
      catalog: { status: "success" },
      inference: { status: "failed", testedAt: expect.any(String), message: "refused" },
    });
    expect(checkSucceeded({} as CustomProvider, "catalog")).toEqual({ catalog: { status: "success", testedAt: expect.any(String) } });
  });

  it("replaces the active model only when the refreshed catalogue lacks it", () => {
    const models = [{ id: "m1", name: "1" }, { id: "m2", name: "2" }];
    expect(replacementActiveModel(models, "m2")).toBeUndefined();
    expect(replacementActiveModel(models, "gone")).toBe("m1");
    expect(replacementActiveModel([], "gone")).toBeUndefined();
  });

  it("summarises a refresh", () => {
    expect(modelsRefreshedMessage(1, 0)).toBe("Loaded 1 supported model.");
    expect(modelsRefreshedMessage(3, 2)).toBe("Loaded 3 supported models; 2 unsupported catalog entries were disabled.");
  });
});
