import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({ invoke }));

import {
  clearLocalStorageCache,
  clearStorageCache,
  formatStorageSize,
  getLocalStorageCacheBytes,
  getStorageCacheBreakdown,
} from "./storageCacheService";

describe("storageCacheService", () => {
  describe("formatStorageSize", () => {
    it("formats 0 and negative bytes as 0 KB", () => {
      expect(formatStorageSize(0)).toBe("0 KB");
      expect(formatStorageSize(-10)).toBe("0 KB");
      expect(formatStorageSize(NaN)).toBe("0 KB");
    });

    it("formats bytes under 1 KB in B", () => {
      expect(formatStorageSize(500)).toBe("500 B");
      expect(formatStorageSize(1023)).toBe("1023 B");
    });

    it("formats kilobytes properly", () => {
      expect(formatStorageSize(1024)).toBe("1.0 KB");
      expect(formatStorageSize(2048)).toBe("2.0 KB");
      expect(formatStorageSize(1024 * 50)).toBe("50.0 KB");
    });

    it("formats megabytes properly", () => {
      expect(formatStorageSize(1024 * 1024)).toBe("1.0 MB");
      expect(formatStorageSize(1024 * 1024 * 14.5)).toBe("14.5 MB");
    });

    it("formats gigabytes properly", () => {
      expect(formatStorageSize(1024 * 1024 * 1024)).toBe("1.00 GB");
      expect(formatStorageSize(1024 * 1024 * 1024 * 2.35)).toBe("2.35 GB");
    });
  });

  describe("localStorage diagnostic cache", () => {
    const memory = new Map<string, string>();

    beforeEach(() => {
      memory.clear();
      vi.stubGlobal("localStorage", {
        getItem: (k: string) => memory.get(k) ?? null,
        setItem: (k: string, v: string) => memory.set(k, v),
        removeItem: (k: string) => memory.delete(k),
        clear: () => memory.clear(),
      });
    });

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it("returns 0 when no diagnostic keys are present", () => {
      expect(getLocalStorageCacheBytes()).toBe(0);
    });

    it("computes size when execution-observability or trajectories are stored", () => {
      memory.set("rusty.execution-observability.v1", "test data");
      expect(getLocalStorageCacheBytes()).toBe("test data".length * 2);
    });

    it("clears diagnostic items without clearing other keys", () => {
      memory.set("rusty.execution-observability.v1", "records");
      memory.set("rusty.run-trajectories.v1", "runs");
      memory.set("other_user_key", "keep this");

      clearLocalStorageCache();

      expect(memory.has("rusty.execution-observability.v1")).toBe(false);
      expect(memory.has("rusty.run-trajectories.v1")).toBe(false);
      expect(memory.get("other_user_key")).toBe("keep this");
    });
  });

  describe("getStorageCacheBreakdown & clearStorageCache", () => {
    beforeEach(() => {
      invoke.mockReset();
    });

    it("combines backend and frontend metrics", async () => {
      invoke.mockResolvedValueOnce({
        cache_bytes: 1024 * 1024 * 10, // 10 MB
        log_bytes: 1024 * 1024 * 5,    // 5 MB
        total_bytes: 1024 * 1024 * 15,
      });

      const breakdown = await getStorageCacheBreakdown();
      expect(breakdown.cacheBytes).toBe(1024 * 1024 * 10);
      expect(breakdown.logBytes).toBe(1024 * 1024 * 5);
      expect(breakdown.formatted).toContain("MB");
    });

    it("clearStorageCache calls Tauri clear and resets cache", async () => {
      invoke.mockResolvedValueOnce({
        cache_bytes: 0,
        log_bytes: 0,
        total_bytes: 0,
      });

      const result = await clearStorageCache();
      expect(invoke).toHaveBeenCalledWith("clear_storage_cache");
      expect(result.cacheBytes).toBe(0);
      expect(result.logBytes).toBe(0);
      expect(result.totalBytes).toBe(0);
      expect(result.formatted).toBe("0 KB");
    });
  });
});
