import { beforeEach, describe, expect, it, vi } from "vitest";
import { createUpdateTestStore } from "../../test/updateTestStore";
import { checkForUpdate, installAndRelaunch } from "../../services/updateService";
import { loadSkippedUpdateVersion, saveSkippedUpdateVersion } from "../../preferences/updates";

vi.mock("../../services/updateService", () => ({
  checkForUpdate: vi.fn(),
  installAndRelaunch: vi.fn(),
}));
vi.mock("../../preferences/updates", () => ({
  loadSkippedUpdateVersion: vi.fn(() => null),
  saveSkippedUpdateVersion: vi.fn(),
}));
vi.mock("@tauri-apps/api/app", () => ({ getVersion: vi.fn(() => Promise.resolve("0.1.28")) }));

const checkForUpdateMock = vi.mocked(checkForUpdate);
const installAndRelaunchMock = vi.mocked(installAndRelaunch);
const loadSkippedUpdateVersionMock = vi.mocked(loadSkippedUpdateVersion);
const saveSkippedUpdateVersionMock = vi.mocked(saveSkippedUpdateVersion);

describe("createUpdateSlice", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    loadSkippedUpdateVersionMock.mockReturnValue(null);
  });

  it("starts idle", () => {
    const store = createUpdateTestStore();
    expect(store.getState().updateState.status).toBe("idle");
  });

  it("checkForUpdates settles 'up-to-date' when no update is found", async () => {
    checkForUpdateMock.mockResolvedValue(null);
    const store = createUpdateTestStore();

    await store.getState().checkForUpdates();

    expect(store.getState().updateState).toMatchObject({
      status: "up-to-date",
      currentVersion: "0.1.28",
      latestVersion: null,
    });
  });

  it("checkForUpdates settles 'available' with the update's metadata", async () => {
    checkForUpdateMock.mockResolvedValue({
      version: "0.2.0",
      currentVersion: "0.1.28",
      notes: "Bug fixes",
      date: "2026-01-01",
    });
    const store = createUpdateTestStore();

    await store.getState().checkForUpdates();

    expect(store.getState().updateState).toMatchObject({
      status: "available",
      currentVersion: "0.1.28",
      latestVersion: "0.2.0",
      releaseNotes: "Bug fixes",
    });
  });

  it("checkForUpdates surfaces a failure as status 'error' without throwing", async () => {
    checkForUpdateMock.mockRejectedValue(new Error("network down"));
    const store = createUpdateTestStore();

    await expect(store.getState().checkForUpdates()).resolves.toBeUndefined();

    expect(store.getState().updateState).toMatchObject({
      status: "error",
      error: "network down",
    });
  });

  it("checkForUpdates carries forward the previously skipped version", async () => {
    loadSkippedUpdateVersionMock.mockReturnValue("0.1.30");
    checkForUpdateMock.mockResolvedValue({ version: "0.1.31", currentVersion: "0.1.28" });
    const store = createUpdateTestStore();

    await store.getState().checkForUpdates();

    expect(store.getState().updateState.skippedVersion).toBe("0.1.30");
  });

  it("installUpdate reports downloading progress, then a stuck state if relaunch never actually happens", async () => {
    installAndRelaunchMock.mockImplementation(async (onProgress) => {
      onProgress?.({ downloadedBytes: 50, contentLength: 100 });
    });
    const store = createUpdateTestStore();

    await store.getState().installUpdate();

    // installAndRelaunch() resolving at all (rather than the process
    // actually relaunching) means the relaunch itself never happened --
    // see createUpdateSlice.ts's comment on why this is treated as a
    // failure rather than silently returning to "idle".
    expect(store.getState().updateState).toMatchObject({
      status: "error",
      downloadedBytes: 50,
      contentLength: 100,
    });
  });

  it("installUpdate surfaces a download/install failure as status 'error'", async () => {
    installAndRelaunchMock.mockRejectedValue(new Error("signature mismatch"));
    const store = createUpdateTestStore();

    await store.getState().installUpdate();

    expect(store.getState().updateState).toMatchObject({
      status: "error",
      error: "signature mismatch",
    });
  });

  it("skipUpdateVersion persists and stores the skipped version", () => {
    const store = createUpdateTestStore();

    store.getState().skipUpdateVersion("0.2.0");

    expect(saveSkippedUpdateVersionMock).toHaveBeenCalledWith("0.2.0");
    expect(store.getState().updateState.skippedVersion).toBe("0.2.0");
  });
});
