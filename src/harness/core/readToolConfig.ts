import type { SmartReadSettings } from "../../store/smartReadTypes";
import { resolveSelectorModel, type SelectorModelConfig, type SmartToolSettingsSources } from "./smartToolConfig";

declare module "../../harness/contract/capabilities" {
  interface AgentChatInput {
    readToolConfig?: ReadToolRunConfig;
  }
  interface ExecuteNodeInput {
    readToolConfig?: ReadToolRunConfig;
  }
}

export interface ReadToolRunConfig {
  mode: "complete" | "semantic";
  selectorModel?: SelectorModelConfig;
}

export const COMPLETE_READ_TOOL_CONFIG: ReadToolRunConfig = { mode: "complete" };

export function snapshotReadToolRunConfig(args: SmartToolSettingsSources & { settings: SmartReadSettings }): ReadToolRunConfig {
  const selectorModel = resolveSelectorModel(args.settings, args, "smart file reading");
  return selectorModel ? { mode: "semantic", selectorModel } : COMPLETE_READ_TOOL_CONFIG;
}
