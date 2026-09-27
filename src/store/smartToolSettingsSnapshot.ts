import type { SmartToolSettingsSnapshot } from "../harness/core/smartToolConfig";
import type { WorkspaceState } from "./types";

/** Captures the smart-tool settings a run starts with. Call it where the run
 * is started, so settings changed mid-run only affect the next run. */
export function snapshotSmartToolSettings(state: WorkspaceState): SmartToolSettingsSnapshot {
  return {
    read: { ...state.smartReadSettings },
    search: { ...state.smartSearchSettings },
    webExtract: { ...state.smartWebExtractSettings },
    providers: state.customProviders,
    providerStatus: state.providerStatus,
    activeProviderId: state.activeCustomProviderId,
  };
}
