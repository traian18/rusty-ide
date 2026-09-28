import type { IntelligentModelSelectionSettings } from "./intelligentModelSelectionTypes";

declare module "./types" {
  interface WorkspaceState {
    intelligentModelSelectionSettings: IntelligentModelSelectionSettings;
    updateIntelligentModelSelectionSettings: (updates: Partial<IntelligentModelSelectionSettings>) => void;
  }
}

export {};
