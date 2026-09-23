import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  SKIPPED_UPDATE_VERSION_STORAGE_KEY,
  loadSkippedUpdateVersion,
  saveSkippedUpdateVersion,
} from "./updates";

describe("preferences/updates", () => {
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

  it("defaults to null on fresh start with empty storage", () => {
    expect(loadSkippedUpdateVersion()).toBeNull();
  });

  it("saveSkippedUpdateVersion persists the version, and loadSkippedUpdateVersion reads it back", () => {
    saveSkippedUpdateVersion("0.2.0");
    expect(store.get(SKIPPED_UPDATE_VERSION_STORAGE_KEY)).toBe("0.2.0");
    expect(loadSkippedUpdateVersion()).toBe("0.2.0");
  });

  it("a later skip overwrites an earlier one", () => {
    saveSkippedUpdateVersion("0.2.0");
    saveSkippedUpdateVersion("0.3.0");
    expect(loadSkippedUpdateVersion()).toBe("0.3.0");
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

    expect(loadSkippedUpdateVersion()).toBeNull();
    expect(() => saveSkippedUpdateVersion("0.2.0")).not.toThrow();
  });
});
