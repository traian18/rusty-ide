import { beforeEach, describe, expect, it, vi } from "vitest";
import { checkForUpdate, installAndRelaunch } from "./updateService";

const checkMock = vi.fn();
const relaunchMock = vi.fn();

vi.mock("@tauri-apps/plugin-updater", () => ({
  check: (...args: unknown[]) => checkMock(...args),
}));
vi.mock("@tauri-apps/plugin-process", () => ({
  relaunch: (...args: unknown[]) => relaunchMock(...args),
}));

describe("updateService", () => {
  beforeEach(() => {
    checkMock.mockReset();
    relaunchMock.mockReset();
  });

  it("checkForUpdate resolves null when already up to date", async () => {
    checkMock.mockResolvedValue(null);

    await expect(checkForUpdate()).resolves.toBeNull();
    expect(checkMock).toHaveBeenCalledWith({ timeout: 5_000 });
  });

  it("checkForUpdate maps the plugin's Update fields and forwards a custom timeout", async () => {
    checkMock.mockResolvedValue({
      version: "0.2.0",
      currentVersion: "0.1.28",
      body: "Notes",
      date: "2026-01-01",
      downloadAndInstall: vi.fn(),
    });

    await expect(checkForUpdate(3_000)).resolves.toEqual({
      version: "0.2.0",
      currentVersion: "0.1.28",
      notes: "Notes",
      date: "2026-01-01",
    });
    expect(checkMock).toHaveBeenCalledWith({ timeout: 3_000 });
  });

  it("installAndRelaunch throws when nothing has been checked for yet", async () => {
    // Module state (pendingUpdate) persists across tests in this file --
    // force it back to null regardless of run order.
    checkMock.mockResolvedValue(null);
    await checkForUpdate();

    await expect(installAndRelaunch()).rejects.toThrow(/no pending update/i);
  });

  it("installAndRelaunch downloads, reports progress, installs, then relaunches", async () => {
    const downloadAndInstall = vi.fn(async (onEvent: (event: unknown) => void) => {
      onEvent({ event: "Started", data: { contentLength: 100 } });
      onEvent({ event: "Progress", data: { chunkLength: 40 } });
      onEvent({ event: "Progress", data: { chunkLength: 60 } });
      onEvent({ event: "Finished" });
    });
    checkMock.mockResolvedValue({
      version: "0.2.0",
      currentVersion: "0.1.28",
      downloadAndInstall,
    });
    await checkForUpdate();

    const progressUpdates: Array<{ downloadedBytes: number; contentLength?: number }> = [];
    await installAndRelaunch((progress) => progressUpdates.push(progress));

    expect(downloadAndInstall).toHaveBeenCalledTimes(1);
    expect(progressUpdates).toEqual([
      { downloadedBytes: 0, contentLength: 100 },
      { downloadedBytes: 40, contentLength: 100 },
      { downloadedBytes: 100, contentLength: 100 },
      { downloadedBytes: 100, contentLength: 100 },
    ]);
    expect(relaunchMock).toHaveBeenCalledTimes(1);
  });
});
