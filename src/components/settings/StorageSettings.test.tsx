// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StorageSettings } from "./StorageSettings";

const mockGetStorageCacheBreakdown = vi.fn();
const mockClearStorageCache = vi.fn();
const mockNotify = vi.fn();

vi.mock("../../services/storageCacheService", () => ({
  getStorageCacheBreakdown: () => mockGetStorageCacheBreakdown(),
  clearStorageCache: () => mockClearStorageCache(),
}));

const mockGetStorageBackend = vi.fn();

vi.mock("../../services/secureStorageService", () => ({
  SecureStorageService: { getStorageBackend: () => mockGetStorageBackend() },
}));

vi.mock("../../notificationStore", () => ({
  notify: (...args: unknown[]) => mockNotify(...args),
}));

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.clearAllMocks();
  mockGetStorageBackend.mockResolvedValue({ backend: "keychain" });
  mockGetStorageCacheBreakdown.mockResolvedValue({
    cacheBytes: 1024 * 1024 * 15,
    logBytes: 1024 * 1024 * 7,
    diagnosticsBytes: 0,
    totalBytes: 1024 * 1024 * 22,
    formatted: "22.0 MB",
  });
  mockClearStorageCache.mockResolvedValue({
    cacheBytes: 0,
    logBytes: 0,
    diagnosticsBytes: 0,
    totalBytes: 0,
    formatted: "0 KB",
  });

  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

describe("StorageSettings component", () => {
  it("renders heading and formatted cache size", async () => {
    await act(async () => root.render(<StorageSettings />));

    expect(container.textContent).toContain("Storage & Cache");
    expect(container.textContent).toContain("22.0 MB");
  });

  it("clears cache and updates displayed size when Delete Cache is clicked", async () => {
    await act(async () => root.render(<StorageSettings />));

    expect(container.textContent).toContain("22.0 MB");

    const deleteBtn = container.querySelector("#storage-cache-delete") as HTMLButtonElement;
    expect(deleteBtn).not.toBeNull();

    await act(async () => {
      deleteBtn.click();
    });

    expect(mockClearStorageCache).toHaveBeenCalled();
    expect(container.textContent).toContain("0 KB");
    expect(mockNotify).toHaveBeenCalledWith(
      "Cache Cleared",
      expect.stringContaining("cleared"),
      "success",
    );
  });

  it("disables delete button when totalBytes is 0", async () => {
    mockGetStorageCacheBreakdown.mockResolvedValueOnce({
      cacheBytes: 0,
      logBytes: 0,
      diagnosticsBytes: 0,
      totalBytes: 0,
      formatted: "0 KB",
    });

    await act(async () => root.render(<StorageSettings />));

    const deleteBtn = container.querySelector("#storage-cache-delete") as HTMLButtonElement;
    expect(deleteBtn.disabled).toBe(true);
  });

  it("says when secrets are protected by the OS keychain", async () => {
    await act(async () => root.render(<StorageSettings />));

    expect(container.textContent).toContain("held in the OS keychain");
  });

  it("warns with the reason when the keychain was unavailable", async () => {
    mockGetStorageBackend.mockResolvedValue({ backend: "file", fallbackReason: "Secret Service unavailable" });

    await act(async () => root.render(<StorageSettings />));

    const alert = container.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain("OS keychain unavailable");
    expect(alert?.textContent).toContain("Secret Service unavailable");
  });

  it("warns when the storage key could not be obtained", async () => {
    mockGetStorageBackend.mockRejectedValue(new Error("keyring is locked"));

    await act(async () => root.render(<StorageSettings />));

    expect(container.querySelector('[role="alert"]')?.textContent).toContain("keyring is locked");
  });
});
