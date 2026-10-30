/** The updater and process plugins the update flow calls. Loaded on first use. */
import type { Update } from "@tauri-apps/plugin-updater";

export type PluginUpdate = Update;

export interface UpdatesClient {
  /** Asks the update endpoint for a newer signed release; null when up to date. */
  check(timeoutMs: number): Promise<PluginUpdate | null>;
  relaunch(): Promise<void>;
  appVersion(): Promise<string>;
}

export const updatesClient: UpdatesClient = {
  async check(timeoutMs) {
    const { check } = await import("@tauri-apps/plugin-updater");
    return check({ timeout: timeoutMs });
  },
  async relaunch() {
    const { relaunch } = await import("@tauri-apps/plugin-process");
    await relaunch();
  },
  async appVersion() {
    const { getVersion } = await import("../../lib/platform/app");
    return getVersion();
  },
};
