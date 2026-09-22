import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  loadHasSeenOnboarding,
  ONBOARDING_SEEN_STORAGE_KEY,
  saveHasSeenOnboarding,
} from "./onboarding";

describe("preferences/onboarding", () => {
  const store = new Map<string, string>();
  const fakeLocalStorage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
    clear: () => {
      store.clear();
    },
  };

  beforeEach(() => {
    store.clear();
    vi.stubGlobal("localStorage", fakeLocalStorage);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("defaults to false on fresh install with empty storage", () => {
    expect(loadHasSeenOnboarding()).toBe(false);
  });

  it("returns true when ONBOARDING_SEEN_STORAGE_KEY is 'true'", () => {
    store.set(ONBOARDING_SEEN_STORAGE_KEY, "true");
    expect(loadHasSeenOnboarding()).toBe(true);
  });

  it("returns true when previous_workspaces exists and has items", () => {
    store.set("previous_workspaces", JSON.stringify(["/Users/dev/my-project"]));
    expect(loadHasSeenOnboarding()).toBe(true);
  });

  it("returns false when previous_workspaces is an empty array", () => {
    store.set("previous_workspaces", JSON.stringify([]));
    expect(loadHasSeenOnboarding()).toBe(false);
  });

  it("saveHasSeenOnboarding writes true to localStorage", () => {
    saveHasSeenOnboarding(true);
    expect(store.get(ONBOARDING_SEEN_STORAGE_KEY)).toBe("true");
    expect(loadHasSeenOnboarding()).toBe(true);
  });

  it("handles throwing localStorage gracefully", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("localStorage blocked");
      },
      setItem: () => {
        throw new Error("localStorage blocked");
      },
    });

    expect(loadHasSeenOnboarding()).toBe(false);
    expect(() => saveHasSeenOnboarding(true)).not.toThrow();
  });
});
