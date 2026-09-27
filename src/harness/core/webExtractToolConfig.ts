import type { SmartWebExtractSettings } from "../../store/smartReadTypes";
import { resolveSelectorModel, type SelectorModelConfig, type SmartToolSettingsSources } from "./smartToolConfig";

declare module "../../harness/contract/capabilities" {
  interface AgentChatInput {
    webExtractToolConfig?: WebExtractToolRunConfig;
  }
  interface ExecuteNodeInput {
    webExtractToolConfig?: WebExtractToolRunConfig;
  }
}

/** `web_extract` is an additional tool rather than a mode of `web_fetch`,
 * so it is either registered for the run or absent. */
export interface WebExtractToolRunConfig {
  enabled: boolean;
  selectorModel?: SelectorModelConfig;
}

export const DISABLED_WEB_EXTRACT_TOOL_CONFIG: WebExtractToolRunConfig = { enabled: false };

export function snapshotWebExtractToolRunConfig(args: SmartToolSettingsSources & { settings: SmartWebExtractSettings }): WebExtractToolRunConfig {
  const selectorModel = resolveSelectorModel(args.settings, args, "smart web extraction");
  return selectorModel ? { enabled: true, selectorModel } : DISABLED_WEB_EXTRACT_TOOL_CONFIG;
}
