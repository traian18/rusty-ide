import type { WorkspaceSliceCreator } from "../sliceTypes";
import type { SmartToolSettings } from "../smartReadTypes";

export const defaultSmartReadSettings: SmartToolSettings = {
  enabled: false,
  providerId: null,
  modelId: null,
};

export const defaultSmartSearchSettings: SmartToolSettings = defaultSmartReadSettings;
export const defaultSmartWebExtractSettings: SmartToolSettings = defaultSmartReadSettings;

const READ_STORAGE_KEY = "rusty_smart_read_settings";
const SEARCH_STORAGE_KEY = "rusty_smart_search_settings";
const WEB_EXTRACT_STORAGE_KEY = "rusty_smart_web_extract_settings";

function loadStoredSettings(key: string): SmartToolSettings {
  if (typeof localStorage === "undefined") return defaultSmartReadSettings;
  try {
    const parsed = JSON.parse(localStorage.getItem(key) || "null") as Partial<SmartToolSettings> | null;
    return {
      enabled: Boolean(parsed?.enabled),
      providerId: typeof parsed?.providerId === "string" ? parsed.providerId : null,
      modelId: typeof parsed?.modelId === "string" ? parsed.modelId : null,
    };
  } catch {
    return defaultSmartReadSettings;
  }
}

function saveStoredSettings(key: string, settings: SmartToolSettings): void {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(key, JSON.stringify(settings));
}

export const createSmartReadSlice: WorkspaceSliceCreator = (set) => ({
  smartReadSettings: loadStoredSettings(READ_STORAGE_KEY),
  updateSmartReadSettings: (updates) => set((state) => {
    const next: SmartToolSettings = { ...state.smartReadSettings, ...updates };
    saveStoredSettings(READ_STORAGE_KEY, next);
    return { smartReadSettings: next };
  }),
  smartSearchSettings: loadStoredSettings(SEARCH_STORAGE_KEY),
  updateSmartSearchSettings: (updates) => set((state) => {
    const next: SmartToolSettings = { ...state.smartSearchSettings, ...updates };
    saveStoredSettings(SEARCH_STORAGE_KEY, next);
    return { smartSearchSettings: next };
  }),
  smartWebExtractSettings: loadStoredSettings(WEB_EXTRACT_STORAGE_KEY),
  updateSmartWebExtractSettings: (updates) => set((state) => {
    const next: SmartToolSettings = { ...state.smartWebExtractSettings, ...updates };
    saveStoredSettings(WEB_EXTRACT_STORAGE_KEY, next);
    return { smartWebExtractSettings: next };
  }),
});
