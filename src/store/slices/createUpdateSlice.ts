import { checkForUpdate, installAndRelaunch } from "../../services/updateService";
import { loadSkippedUpdateVersion, saveSkippedUpdateVersion } from "../../preferences/updates";
import type { WorkspaceSliceCreator } from "../sliceTypes";

export type UpdateCheckStatus =
  | "idle"
  | "checking"
  | "up-to-date"
  | "available"
  | "downloading"
  | "error";

export interface UpdateState {
  status: UpdateCheckStatus;
  currentVersion: string | null;
  latestVersion: string | null;
  releaseNotes: string | null;
  error: string | null;
  lastCheckedAt: string | null;
  /** The version the user chose "Skip This Version" for, if any -- the
      update-available prompt stays hidden for exactly this version, but
      reappears the moment a newer one ships. */
  skippedVersion: string | null;
  downloadedBytes: number;
  contentLength: number | null;
}

const UPDATE_STATE_DEFAULTS: UpdateState = {
  status: "idle",
  currentVersion: null,
  latestVersion: null,
  releaseNotes: null,
  error: null,
  lastCheckedAt: null,
  skippedVersion: null,
  downloadedBytes: 0,
  contentLength: null,
};

/**
 * Update checking against tauri.conf.json's `plugins.updater.endpoints`
 * (GitHub's `latest.json` for this repo). Deliberately never throws from
 * checkForUpdates()/installUpdate() -- both callers (the fire-and-forget
 * background check kicked off from AppBootstrapBoundary.tsx once startup
 * settles, and the "Check for Updates" button in Settings) need a no-throw
 * contract so a network hiccup here can never surface as an unhandled
 * rejection; failures just land in `status: "error"` / `error`.
 */
export const createUpdateSlice: WorkspaceSliceCreator = (set) => ({
  updateState: { ...UPDATE_STATE_DEFAULTS },

  checkForUpdates: async () => {
    set((state) => ({ updateState: { ...state.updateState, status: "checking", error: null } }));

    let currentVersion: string | null = null;
    try {
      const { getVersion } = await import("@tauri-apps/api/app");
      currentVersion = await getVersion();
    } catch {
      // Non-Tauri environment (tests, web preview) -- leave null.
    }

    try {
      const update = await checkForUpdate();
      const skippedVersion = loadSkippedUpdateVersion();
      set({
        updateState: {
          ...UPDATE_STATE_DEFAULTS,
          currentVersion: update?.currentVersion ?? currentVersion,
          latestVersion: update?.version ?? null,
          releaseNotes: update?.notes ?? null,
          status: update ? "available" : "up-to-date",
          lastCheckedAt: new Date().toISOString(),
          skippedVersion,
        },
      });
    } catch (error) {
      set((state) => ({
        updateState: {
          ...state.updateState,
          currentVersion: state.updateState.currentVersion ?? currentVersion,
          status: "error",
          error: error instanceof Error ? error.message : String(error),
          lastCheckedAt: new Date().toISOString(),
        },
      }));
    }
  },

  installUpdate: async () => {
    set((state) => ({
      updateState: { ...state.updateState, status: "downloading", error: null, downloadedBytes: 0 },
    }));
    try {
      await installAndRelaunch(({ downloadedBytes, contentLength }) => {
        set((state) => ({
          updateState: { ...state.updateState, downloadedBytes, contentLength: contentLength ?? null },
        }));
      });
      // installAndRelaunch() ends by relaunching the app (or, on Windows,
      // exiting it) -- if this line runs at all, the relaunch itself never
      // happened, which is itself a failure worth surfacing.
      set((state) => ({
        updateState: { ...state.updateState, status: "error", error: "The app did not restart after installing the update." },
      }));
    } catch (error) {
      set((state) => ({
        updateState: {
          ...state.updateState,
          status: "error",
          error: error instanceof Error ? error.message : String(error),
        },
      }));
    }
  },

  skipUpdateVersion: (version: string) => {
    saveSkippedUpdateVersion(version);
    set((state) => ({ updateState: { ...state.updateState, skippedVersion: version } }));
  },
});
