import { describe, expect, it } from "vitest";
import { snapshotContextCompaction } from "./jevDecisionToolSnapshot";
import type { WorkspaceState } from "../../../store/types";

function state(opts: { enabled: boolean; withJev: boolean; apiKey?: string; summaries?: boolean }): WorkspaceState {
  const provider = {
    id: "openrouter",
    apiKey: opts.apiKey ?? "sk-test",
    models: opts.withJev ? [{ id: "typesafe/jev-1.13", remoteId: "typesafe/jev-1.13", name: "JEV" }] : [],
  };
  return {
    customProviders: [provider],
    intelligentModelSelectionSettings: { jevModelId: null, contextSummariesEnabled: opts.summaries ?? true, smartContextCompactionEnabled: opts.enabled, decisionConfidenceThreshold: 0.7 },
  } as unknown as WorkspaceState;
}

describe("snapshotContextCompaction", () => {
  it("summarizes without JEV by default", () => {
    expect(snapshotContextCompaction(state({ enabled: false, withJev: true }))).toEqual({ mode: "smart" });
  });
  it("only trims locally when summaries are off, even with JEV on", () => {
    expect(snapshotContextCompaction(state({ enabled: true, withJev: true, summaries: false }))).toEqual({ mode: "standard" });
  });
  it("adds JEV ratings when enabled and JEV is available", () => {
    const config = snapshotContextCompaction(state({ enabled: true, withJev: true }));
    expect(config.mode).toBe("smart");
    expect(config.jev).toMatchObject({ apiKey: "sk-test", confidence: 0.7 });
  });
  it("still summarizes, without ratings, when enabled but JEV is unavailable", () => {
    expect(snapshotContextCompaction(state({ enabled: true, withJev: false }))).toEqual({ mode: "smart" });
    expect(snapshotContextCompaction(state({ enabled: true, withJev: true, apiKey: " " }))).toEqual({ mode: "smart" });
  });
});
