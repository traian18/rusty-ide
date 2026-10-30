import { create } from "zustand";
import { createPreferencesSlice } from "../features/settings/state/preferences";
import type { WorkspaceState } from "../store/types";

/**
 * Composes only createPreferencesSlice, which imports nothing but the two
 * pure `preferences/*` modules -- no Tauri, no localStorage read at
 * creation time (REFACTOR_PLAN.md PR 3a's purity fix).
 */
export function createPreferencesTestStore(overrides: Partial<WorkspaceState> = {}) {
  return create<WorkspaceState>()((...args) => ({
    ...createPreferencesSlice(...args),
    ...overrides,
  }) as unknown as WorkspaceState);
}
