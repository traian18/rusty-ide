/** Every command settings calls: the installation key for secure storage and the cache sizes. */
import type { StorageKeyBackend } from "./service/secureStorageService";

/** Calls a Tauri command by name. The app passes the real bridge; tests pass a fake one. */
export type Invoke = <T>(command: string, args?: Record<string, unknown>) => Promise<T>;

export interface StorageKeyResponse {
  key: string;
  backend: StorageKeyBackend;
  fallbackReason?: string;
}

export interface CacheInfo {
  cache_bytes: number;
  log_bytes: number;
  total_bytes: number;
}

export interface SettingsClient {
  storageKey(): Promise<StorageKeyResponse>;
  cacheSize(): Promise<CacheInfo>;
  clearCache(): Promise<CacheInfo>;
}

/** Builds the settings client on a command bridge. Each method names one Tauri command and its arguments. */
export function createSettingsClient(call: Invoke): SettingsClient {
  return {
    storageKey: () => call<StorageKeyResponse>("get_storage_key"),
    cacheSize: () => call<CacheInfo>("get_storage_cache_size"),
    clearCache: () => call<CacheInfo>("clear_storage_cache"),
  };
}

/** Loads the Tauri bridge on first use, so tests and plain-browser builds never pull it in. */
const lazyInvoke: Invoke = async (command, args) => {
  const { invoke } = await import("@tauri-apps/api/core");
  return args === undefined ? invoke(command) : invoke(command, args);
};

export const settingsClient = createSettingsClient(lazyInvoke);
