import { create } from "zustand";
import { createUpdateSlice } from "../store/slices/createUpdateSlice";
import type { WorkspaceState } from "../store/types";

/** Composes only createUpdateSlice, whose only dependencies (updateService,
 * preferences/updates, @tauri-apps/api/app) are all mocked at the module
 * level in createUpdateSlice.test.ts -- mirrors createStartupTestStore. */
export function createUpdateTestStore(overrides: Partial<WorkspaceState> = {}) {
  return create<WorkspaceState>()((...args) => ({
    ...createUpdateSlice(...args),
    ...overrides,
  }) as unknown as WorkspaceState);
}
