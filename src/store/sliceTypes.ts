import type { StateCreator } from "zustand";
import type { WorkspaceState } from "./types";

export type WorkspaceSliceCreator = StateCreator<
  WorkspaceState,
  [],
  [],
  Partial<WorkspaceState>
>;
