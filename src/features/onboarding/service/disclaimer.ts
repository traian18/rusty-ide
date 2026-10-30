/**
 * Pure helpers for tracking whether the user has reviewed and accepted
 * the first-launch AI model disclaimer and liability notice.
 *
 * Adheres to the slice import-time purity rule by isolating localStorage
 * access to explicit calls.
 */

export const DISCLAIMER_ACCEPTED_STORAGE_KEY = "rusty_has_accepted_disclaimer";

/**
 * Checks whether the user has accepted the AI disclaimer.
 *
 * Returns true only if DISCLAIMER_ACCEPTED_STORAGE_KEY is explicitly "true".
 * Defaults to false for new users so the disclaimer modal is displayed on first run.
 */
export function loadHasAcceptedDisclaimer(): boolean {
  if (typeof localStorage === "undefined") return false;
  try {
    return localStorage.getItem(DISCLAIMER_ACCEPTED_STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

/**
 * Persists the disclaimer acceptance state into localStorage.
 */
export function saveHasAcceptedDisclaimer(accepted: boolean = true): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(DISCLAIMER_ACCEPTED_STORAGE_KEY, String(accepted));
  } catch {
    // Best-effort persistence in restricted storage environments
  }
}
