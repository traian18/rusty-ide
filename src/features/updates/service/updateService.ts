/**
 * Wraps `@tauri-apps/plugin-updater` / `@tauri-apps/plugin-process` behind a
 * plain async API, the same "dynamic import, swallow in non-Tauri
 * environments" shape storageCacheService.ts already uses -- keeps the
 * update slice/tests free of a hard dependency on the Tauri plugin.
 *
 * The checked `Update` resource is held here, module-level, between
 * checkForUpdate() and installUpdate(): the updater plugin's `check()` is
 * the only call that can produce one, and downloadAndInstall() must be
 * called on that same instance, not re-derived from just a version string.
 */

import { updatesClient, type PluginUpdate } from "../client";

export interface UpdateInfo {
  version: string;
  currentVersion: string;
  notes?: string;
  date?: string;
}

export interface UpdateDownloadProgress {
  downloadedBytes: number;
  contentLength?: number;
}

let pendingUpdate: PluginUpdate | null = null;

/**
 * Checks GitHub's `latest.json` (tauri.conf.json's `plugins.updater.endpoints`)
 * for a newer signed release. Resolves `null` when already up to date.
 * `timeoutMs` bounds the network round trip -- callers on the startup path
 * rely on this never hanging past that budget.
 */
export async function checkForUpdate(timeoutMs = 5_000): Promise<UpdateInfo | null> {
  const update = await updatesClient.check(timeoutMs);
  pendingUpdate = update;
  if (!update) return null;
  return {
    version: update.version,
    currentVersion: update.currentVersion,
    notes: update.body,
    date: update.date,
  };
}

/**
 * Downloads and installs the update found by the most recent checkForUpdate()
 * call, then relaunches the app. Throws if no update has been checked for.
 *
 * On Windows, the installer exits the process itself once launched, so the
 * relaunch() call below is never reached there -- harmless, since there is
 * nothing left to relaunch into.
 */
export async function installAndRelaunch(onProgress?: (progress: UpdateDownloadProgress) => void): Promise<void> {
  const update = pendingUpdate;
  if (!update) {
    throw new Error("No pending update to install -- call checkForUpdate() first.");
  }

  let downloadedBytes = 0;
  let contentLength: number | undefined;
  await update.downloadAndInstall((event) => {
    if (event.event === "Started") {
      contentLength = event.data.contentLength;
    } else if (event.event === "Progress") {
      downloadedBytes += event.data.chunkLength;
    }
    onProgress?.({ downloadedBytes, contentLength });
  });

  await updatesClient.relaunch();
}
