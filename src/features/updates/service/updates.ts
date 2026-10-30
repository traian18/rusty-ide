/**
 * Pure helpers for the "skip this version" choice on the update-available
 * prompt (see createUpdateSlice.ts). Mirrors disclaimer.ts/theme.ts's shape
 * deliberately -- localStorage access isolated to explicit calls, never at
 * slice-creation time (ARCHITECTURE.md's "slice import-time purity" rule).
 */

export const SKIPPED_UPDATE_VERSION_STORAGE_KEY = "rusty_skipped_update_version";

/** `null` means the user has never skipped a version (or localStorage is unavailable). */
export function loadSkippedUpdateVersion(): string | null {
  if (typeof localStorage === "undefined") return null;
  try {
    return localStorage.getItem(SKIPPED_UPDATE_VERSION_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function saveSkippedUpdateVersion(version: string): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(SKIPPED_UPDATE_VERSION_STORAGE_KEY, version);
  } catch {
    // Best-effort persistence; a full/disabled localStorage just means the
    // prompt may reappear for a version the user already skipped.
  }
}
