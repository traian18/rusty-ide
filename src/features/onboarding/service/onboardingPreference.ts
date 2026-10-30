/**
 * Pure helpers for tracking whether the user has seen or completed onboarding.
 *
 * Called only from `createTabsSlice.hydrateTabs()` and user-triggered tab actions,
 * never from the slice initializer: ARCHITECTURE.md's "slice import-time purity"
 * rule forbids I/O at slice creation time.
 */

export const ONBOARDING_SEEN_STORAGE_KEY = "rusty_has_seen_onboarding";

/**
 * Checks whether the onboarding tab has already been seen or completed.
 *
 * Defaults to false for brand new installs (so the onboarding guide opens on first run).
 * Returns true if:
 * 1. The ONBOARDING_SEEN_STORAGE_KEY is explicitly marked "true", OR
 * 2. Existing workspaces already exist in localStorage (meaning an existing user upgraded).
 */
export function loadHasSeenOnboarding(): boolean {
  if (typeof localStorage === "undefined") return false;
  try {
    if (localStorage.getItem(ONBOARDING_SEEN_STORAGE_KEY) === "true") {
      return true;
    }
    const prev = localStorage.getItem("previous_workspaces");
    if (prev) {
      const parsed = JSON.parse(prev);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return true;
      }
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * Persists the onboarding seen state into localStorage.
 */
export function saveHasSeenOnboarding(seen: boolean = true): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(ONBOARDING_SEEN_STORAGE_KEY, String(seen));
  } catch {
    // Best-effort persistence in restricted storage environments
  }
}
