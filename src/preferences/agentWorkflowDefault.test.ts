import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AGENT_WORKFLOW_OPT_OUT_STORAGE_KEY,
  loadAgentWorkflowOptOut,
  saveAgentWorkflowOptOut,
} from "./agentWorkflowDefault";

describe("preferences/agentWorkflowDefault", () => {
  const store = new Map<string, string>();

  beforeEach(() => {
    store.clear();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
      removeItem: (key: string) => void store.delete(key),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("follows the starter flow by default", () => {
    expect(loadAgentWorkflowOptOut()).toBe(false);
  });

  it("remembers an opt-out, and forgets it when a workflow is chosen again", () => {
    saveAgentWorkflowOptOut(true);
    expect(store.get(AGENT_WORKFLOW_OPT_OUT_STORAGE_KEY)).toBe("true");
    expect(loadAgentWorkflowOptOut()).toBe(true);

    saveAgentWorkflowOptOut(false);
    expect(store.has(AGENT_WORKFLOW_OPT_OUT_STORAGE_KEY)).toBe(false);
    expect(loadAgentWorkflowOptOut()).toBe(false);
  });

  it("falls back to the default when storage is unavailable", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
      removeItem: () => {
        throw new Error("blocked");
      },
    });
    expect(loadAgentWorkflowOptOut()).toBe(false);
    expect(() => saveAgentWorkflowOptOut(true)).not.toThrow();
  });
});
