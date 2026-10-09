import { describe, expect, it } from "vitest";
import { snapshotContextCompaction } from "./jevDecisionToolSnapshot";
import type { WorkspaceState } from "../store/types";

function state(opts: { enabled: boolean; withJev: boolean; apiKey?: string }): WorkspaceState {
  const provider = {
    id: "openrouter",
    apiKey: opts.apiKey ?? "sk-test",
    models: opts.withJev ? [{ id: "typesafe/jev-1.13", remoteId: "typesafe/jev-1.13", name: "JEV" }] : [],
  };
  return {
    customProviders: [provider],
    intelligentModelSelectionSettings: { jevModelId: null, smartContextCompactionEnabled: opts.enabled, decisionConfidenceThreshold: 0.7 },
  } as unknown as WorkspaceState;
}

describe("snapshotContextCompaction", () => {
  it("defaults to standard when the setting is off, even with JEV available", () => {
    expect(snapshotContextCompaction(state({ enabled: false, withJev: true }))).toEqual({ mode: "standard" });
  });
  it("uses smart mode when enabled and JEV is available", () => {
    const config = snapshotContextCompaction(state({ enabled: true, withJev: true }));
    expect(config.mode).toBe("smart");
    expect(config.jev).toMatchObject({ apiKey: "sk-test", confidence: 0.7 });
  });
  it("falls back to standard when enabled but JEV is unavailable", () => {
    expect(snapshotContextCompaction(state({ enabled: true, withJev: false }))).toEqual({ mode: "standard" });
    expect(snapshotContextCompaction(state({ enabled: true, withJev: true, apiKey: " " }))).toEqual({ mode: "standard" });
  });
});
