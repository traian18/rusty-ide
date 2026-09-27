import type { SmartSearchSettings } from "../../store/smartReadTypes";
import { resolveSelectorModel, type SelectorModelConfig, type SmartToolSettingsSources } from "./smartToolConfig";

declare module "../../harness/contract/capabilities" {
  interface AgentChatInput {
    searchToolConfig?: SearchToolRunConfig;
  }
  interface ExecuteNodeInput {
    searchToolConfig?: SearchToolRunConfig;
  }
}

/** `raw`: the plain pattern search. `ranked`: a described request becomes
 * search patterns, and the deterministic matches are ranked and capped. */
export interface SearchToolRunConfig {
  mode: "raw" | "ranked";
  selectorModel?: SelectorModelConfig;
}

export const RAW_SEARCH_TOOL_CONFIG: SearchToolRunConfig = { mode: "raw" };

export function snapshotSearchToolRunConfig(args: SmartToolSettingsSources & { settings: SmartSearchSettings }): SearchToolRunConfig {
  const selectorModel = resolveSelectorModel(args.settings, args, "smart code search");
  return selectorModel ? { mode: "ranked", selectorModel } : RAW_SEARCH_TOOL_CONFIG;
}
