import { createRunHost } from "../../hostDefaults";
import type { RunHost } from "../../contract";
import type { HostToolHandler } from "../CoreHarness";
import type { HostToolSpec, SessionRecipe } from "../SessionRecipe";
import { COMPLETE_READ_TOOL_CONFIG, snapshotReadToolRunConfig, type ReadToolRunConfig } from "../readToolConfig";
import { RAW_SEARCH_TOOL_CONFIG, snapshotSearchToolRunConfig, type SearchToolRunConfig } from "../searchToolConfig";
import { DISABLED_WEB_EXTRACT_TOOL_CONFIG, snapshotWebExtractToolRunConfig, type WebExtractToolRunConfig } from "../webExtractToolConfig";
import type { SmartToolSettingsSnapshot } from "../smartToolConfig";
import { resolveReadFileTool } from "./readTool";
import { resolveSearchCodebaseTool } from "./searchTool";
import { resolveWebExtractTool } from "./webExtractTool";

/** The input fields every capability with smart retrieval tools shares. */
export interface SmartToolInput {
  workspaceRoot: string;
  inputFiles?: unknown;
  readToolConfig?: ReadToolRunConfig;
  searchToolConfig?: SearchToolRunConfig;
  webExtractToolConfig?: WebExtractToolRunConfig;
  smartToolSettings?: SmartToolSettingsSnapshot;
}

/** The system-prompt lines a capability uses for each tool mode. The plain
 * variants must match the base definition's own text exactly, since they are
 * what gets replaced. */
export interface SmartToolDescriptions {
  read: { complete: string; semantic: string };
  search: { raw: string; ranked: string };
  /** `web_extract` is added, not swapped: its line goes right after the
   * base definition's own `web_fetch` line (`after`). */
  webExtract: { after: string; line: string };
}

/** Resolves the run's smart-tool configuration onto its input exactly once,
 * from the settings snapshot the caller captured at run start, so `recipe()`
 * and `hostTools()` -- and every call in the run -- see the same
 * configuration even if settings change mid-run. Without a snapshot every
 * smart tool stays off. Throws (failing the run) when a smart tool is
 * enabled without a usable selector model. */
export function ensureSmartToolConfigs(input: SmartToolInput): { read: ReadToolRunConfig; search: SearchToolRunConfig; webExtract: WebExtractToolRunConfig } {
  const settings = input.smartToolSettings;
  input.readToolConfig ??= settings ? snapshotReadToolRunConfig({ ...settings, settings: settings.read }) : COMPLETE_READ_TOOL_CONFIG;
  input.searchToolConfig ??= settings ? snapshotSearchToolRunConfig({ ...settings, settings: settings.search }) : RAW_SEARCH_TOOL_CONFIG;
  input.webExtractToolConfig ??= settings ? snapshotWebExtractToolRunConfig({ ...settings, settings: settings.webExtract }) : DISABLED_WEB_EXTRACT_TOOL_CONFIG;
  return { read: input.readToolConfig, search: input.searchToolConfig, webExtract: input.webExtractToolConfig };
}

function resolveTools(input: SmartToolInput, host: RunHost) {
  const configs = ensureSmartToolConfigs(input);
  return {
    configs,
    read: resolveReadFileTool(configs.read, { workspaceRoot: input.workspaceRoot, host, inputFiles: input.inputFiles }),
    search: resolveSearchCodebaseTool(configs.search, { workspaceRoot: input.workspaceRoot }),
    webExtract: resolveWebExtractTool(configs.webExtract, { workspaceRoot: input.workspaceRoot }),
  };
}

export function applySmartToolsToRecipe(recipe: SessionRecipe, input: SmartToolInput, descriptions: SmartToolDescriptions): SessionRecipe {
  const { configs, read, search, webExtract } = resolveTools(input, createRunHost());
  const specs: Record<string, HostToolSpec> = {
    read_file: read.spec,
    search_codebase: search.spec,
  };
  const systemPrompt = recipe.system_prompt
    ?.replace(descriptions.read.complete, configs.read.mode === "semantic" ? descriptions.read.semantic : descriptions.read.complete)
    .replace(descriptions.search.raw, configs.search.mode === "ranked" ? descriptions.search.ranked : descriptions.search.raw)
    .replace(descriptions.webExtract.after, webExtract ? `${descriptions.webExtract.after}\n${descriptions.webExtract.line}` : descriptions.webExtract.after);
  const hostTools = recipe.host_tools?.map((tool) => specs[tool.name] ?? tool);
  return {
    ...recipe,
    system_prompt: systemPrompt,
    host_tools: webExtract ? [...(hostTools ?? []), webExtract.spec] : hostTools,
  };
}

/** Swaps only handlers the base definition registered, so a skill that
 * disabled a tool keeps it disabled. `web_extract` rides on `web_fetch`,
 * which both capabilities always register; rusty-core's execution policy
 * gates it by the same network grant. */
export function applySmartToolHandlers(handlers: Record<string, HostToolHandler>, input: SmartToolInput, host: RunHost): Record<string, HostToolHandler> {
  const { read, search, webExtract } = resolveTools(input, host);
  if (handlers.read_file) handlers.read_file = read.handler;
  if (handlers.search_codebase) handlers.search_codebase = search.handler;
  if (webExtract) handlers.web_extract = webExtract.handler;
  return handlers;
}
