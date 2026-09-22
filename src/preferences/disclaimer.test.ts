import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DISCLAIMER_ACCEPTED_STORAGE_KEY,
  loadHasAcceptedDisclaimer,
  saveHasAcceptedDisclaimer,
} from "./disclaimer";

describe("preferences/disclaimer", () => {
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

  it("defaults to false on fresh start with empty storage", () => {
    expect(loadHasAcceptedDisclaimer()).toBe(false);
  });

  it("returns true when DISCLAIMER_ACCEPTED_STORAGE_KEY is 'true'", () => {
    store.set(DISCLAIMER_ACCEPTED_STORAGE_KEY, "true");
    expect(loadHasAcceptedDisclaimer()).toBe(true);
  });

  it("returns false when DISCLAIMER_ACCEPTED_STORAGE_KEY is 'false' or invalid", () => {
    store.set(DISCLAIMER_ACCEPTED_STORAGE_KEY, "false");
    expect(loadHasAcceptedDisclaimer()).toBe(false);
    store.set(DISCLAIMER_ACCEPTED_STORAGE_KEY, "invalid");
    expect(loadHasAcceptedDisclaimer()).toBe(false);
  });

  it("saveHasAcceptedDisclaimer writes true to localStorage", () => {
    saveHasAcceptedDisclaimer(true);
    expect(store.get(DISCLAIMER_ACCEPTED_STORAGE_KEY)).toBe("true");
    expect(loadHasAcceptedDisclaimer()).toBe(true);
  });

  it("saveHasAcceptedDisclaimer can write false to localStorage", () => {
    saveHasAcceptedDisclaimer(false);
    expect(store.get(DISCLAIMER_ACCEPTED_STORAGE_KEY)).toBe("false");
    expect(loadHasAcceptedDisclaimer()).toBe(false);
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

    expect(loadHasAcceptedDisclaimer()).toBe(false);
    expect(() => saveHasAcceptedDisclaimer(true)).not.toThrow();
  });
});
