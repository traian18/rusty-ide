/**
 * Service for querying and clearing application cache, logs, and diagnostic history.
 *
 * Integrates with:
 * 1. Tauri backend `get_storage_cache_size` and `clear_storage_cache` (WebKit cache, app logs, sidecar logs).
 * 2. Local diagnostic/observability history stored in user storage (localStorage).
 */

export interface TauriCacheInfo {
  cache_bytes: number;
  log_bytes: number;
  total_bytes: number;
}

export interface StorageCacheBreakdown {
  cacheBytes: number;
  logBytes: number;
  diagnosticsBytes: number;
  totalBytes: number;
  formatted: string;
}

export const DIAGNOSTIC_STORAGE_KEYS = [
  "rusty.execution-observability.v1",
  "rusty.run-trajectories.v1",
] as const;

/**
 * Formats a byte count into a human-readable string using B, KB, MB, or GB
 * based on the size magnitude.
 */
export function formatStorageSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 KB";
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb.toFixed(1)} MB`;
  const gb = mb / 1024;
  return `${gb.toFixed(2)} GB`;
}

/**
 * Computes bytes consumed by diagnostic execution and trajectory logs in user storage.
 */
export function getLocalStorageCacheBytes(): number {
  if (typeof localStorage === "undefined") return 0;
  try {
    let total = 0;
    for (const key of DIAGNOSTIC_STORAGE_KEYS) {
      const item = localStorage.getItem(key);
      if (item) {
        total += item.length * 2; // JS UTF-16 character byte approximation
      }
    }
    return total;
  } catch {
    return 0;
  }
}

/**
 * Removes cached diagnostic and trajectory logs from localStorage.
 */
export function clearLocalStorageCache(): void {
  if (typeof localStorage === "undefined") return;
  try {
    for (const key of DIAGNOSTIC_STORAGE_KEYS) {
      localStorage.removeItem(key);
    }
  } catch {
    // Storage access may be restricted
  }
}

/**
 * Fetches total cache, log, and diagnostic storage size.
 */
export async function getStorageCacheBreakdown(): Promise<StorageCacheBreakdown> {
  let cacheBytes = 0;
  let logBytes = 0;

  try {
    const { invoke } = await import("@tauri-apps/api/core");
    const info = await invoke<TauriCacheInfo>("get_storage_cache_size");
    cacheBytes = info.cache_bytes;
    logBytes = info.log_bytes;
  } catch {
    // Non-Tauri or test environments gracefully default to 0
  }

  const diagnosticsBytes = getLocalStorageCacheBytes();
  const totalBytes = cacheBytes + logBytes + diagnosticsBytes;

  return {
    cacheBytes,
    logBytes,
    diagnosticsBytes,
    totalBytes,
    formatted: formatStorageSize(totalBytes),
  };
}

/**
 * Clears application cache, truncates log files, and removes local diagnostic history.
 * Returns the updated breakdown after deletion.
 */
export async function clearStorageCache(): Promise<StorageCacheBreakdown> {
  let cacheBytes = 0;
  let logBytes = 0;

  try {
    const { invoke } = await import("@tauri-apps/api/core");
    const info = await invoke<TauriCacheInfo>("clear_storage_cache");
    cacheBytes = info.cache_bytes;
    logBytes = info.log_bytes;
  } catch {
    // Non-Tauri or test environments
  }

  clearLocalStorageCache();
  const diagnosticsBytes = getLocalStorageCacheBytes();
  const totalBytes = cacheBytes + logBytes + diagnosticsBytes;

  return {
    cacheBytes,
    logBytes,
    diagnosticsBytes,
    totalBytes,
    formatted: formatStorageSize(totalBytes),
  };
}
