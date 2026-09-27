/** Global settings for one smart retrieval tool: whether it is enabled and
 * which selector provider/model performs its internal selection. */
export interface SmartToolSettings {
  enabled: boolean;
  providerId: string | null;
  modelId: string | null;
}

export type SmartReadSettings = SmartToolSettings;
export type SmartSearchSettings = SmartToolSettings;
export type SmartWebExtractSettings = SmartToolSettings;

declare module "./types" {
  interface WorkspaceState {
    smartReadSettings: SmartReadSettings;
    updateSmartReadSettings: (settings: Partial<SmartReadSettings>) => void;
    smartSearchSettings: SmartSearchSettings;
    updateSmartSearchSettings: (settings: Partial<SmartSearchSettings>) => void;
    smartWebExtractSettings: SmartWebExtractSettings;
    updateSmartWebExtractSettings: (settings: Partial<SmartWebExtractSettings>) => void;
  }
}
