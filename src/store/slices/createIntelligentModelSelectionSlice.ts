import "../intelligentModelSelectionState";
import type { WorkspaceSliceCreator } from "../sliceTypes";
import { AUTO_LEVELS, type IntelligentModelSelectionSettings } from "../intelligentModelSelectionTypes";

export const defaultIntelligentModelSelectionSettings: IntelligentModelSelectionSettings = {
  enabled: false,
  jevModelId: null,
  levelModels: { light: null, standard: null, heavy: null },
};

const STORAGE_KEY = "rusty_intelligent_model_selection_settings";

function loadStoredSettings(): IntelligentModelSelectionSettings {
  if (typeof localStorage === "undefined") return defaultIntelligentModelSelectionSettings;
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null") as Partial<IntelligentModelSelectionSettings> | null;
    return {
      enabled: Boolean(parsed?.enabled),
      jevModelId: typeof parsed?.jevModelId === "string" && parsed.jevModelId.trim()
        ? parsed.jevModelId.trim()
        : null,
      levelModels: Object.fromEntries(AUTO_LEVELS.map((level) => {
        const id = parsed?.levelModels?.[level];
        return [level, typeof id === "string" && id.trim() ? id.trim() : null];
      })) as IntelligentModelSelectionSettings["levelModels"],
    };
  } catch {
    return defaultIntelligentModelSelectionSettings;
  }
}

function saveStoredSettings(settings: IntelligentModelSelectionSettings): void {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}

export const createIntelligentModelSelectionSlice: WorkspaceSliceCreator = (set) => ({
  intelligentModelSelectionSettings: loadStoredSettings(),
  updateIntelligentModelSelectionSettings: (updates) => set((state) => {
    const next: IntelligentModelSelectionSettings = { ...state.intelligentModelSelectionSettings, ...updates };
    saveStoredSettings(next);
    return { intelligentModelSelectionSettings: next };
  }),
});
