import { describe, expect, it } from "vitest";
import type { CustomProvider } from "../../../store/types";
import type { RunHost } from "../../contract";
import type { SessionRecipe } from "../SessionRecipe";
import { SEARCH_CODEBASE_TOOL, READ_FILE_TOOL } from "./exploreTools";
import { SEMANTIC_READ_FILE_TOOL } from "./readTool";
import { RANKED_SEARCH_CODEBASE_TOOL } from "./searchTool";
import { WEB_EXTRACT_TOOL } from "./webExtractTool";
import { applySmartToolHandlers, applySmartToolsToRecipe, ensureSmartToolConfigs, type SmartToolDescriptions, type SmartToolInput } from "./smartTools";

const DESCRIPTIONS: SmartToolDescriptions = {
  read: { complete: "- read plain", semantic: "- read smart" },
  search: { raw: "- search plain", ranked: "- search smart" },
  webExtract: { after: "- web_fetch plain", line: "- web_extract" },
};

const SELECTOR = { providerId: "sel", modelId: "m", provider: { id: "sel", name: "Sel" } as CustomProvider };

function recipe(): SessionRecipe {
  return {
    workspace: { root: "/ws", binding: "host" },
    system_prompt: "Tools:\n- read plain\n- search plain\n- web_fetch plain",
    host_tools: [READ_FILE_TOOL, SEARCH_CODEBASE_TOOL],
  } as SessionRecipe;
}

const OFF = { enabled: false, providerId: null, modelId: null };
const settingsSnapshot = (search = OFF) => ({
  read: OFF,
  search,
  webExtract: OFF,
  providers: [],
  providerStatus: {},
  activeProviderId: null,
});

describe("smart tool run snapshot", () => {
  it("defaults to the plain tools when smart retrieval is disabled", () => {
    const input: SmartToolInput = { workspaceRoot: "/ws" };
    expect(ensureSmartToolConfigs(input)).toEqual({ read: { mode: "complete" }, search: { mode: "raw" }, webExtract: { enabled: false } });

    const applied = applySmartToolsToRecipe(recipe(), input, DESCRIPTIONS);
    expect(applied.host_tools).toEqual([READ_FILE_TOOL, SEARCH_CODEBASE_TOOL]);
    expect(applied.system_prompt).toBe("Tools:\n- read plain\n- search plain\n- web_fetch plain");
  });

  it("derives specs and prompt lines for every smart tool from the run's snapshot", () => {
    const input: SmartToolInput = {
      workspaceRoot: "/ws",
      readToolConfig: { mode: "semantic", selectorModel: SELECTOR },
      searchToolConfig: { mode: "ranked", selectorModel: SELECTOR },
      webExtractToolConfig: { enabled: true, selectorModel: SELECTOR },
    };
    const applied = applySmartToolsToRecipe(recipe(), input, DESCRIPTIONS);

    expect(applied.host_tools).toEqual([SEMANTIC_READ_FILE_TOOL, RANKED_SEARCH_CODEBASE_TOOL, WEB_EXTRACT_TOOL]);
    expect(applied.system_prompt).toBe("Tools:\n- read smart\n- search smart\n- web_fetch plain\n- web_extract");
  });

  it("resolves the run's settings snapshot once, so later changes don't affect the run", () => {
    const input: SmartToolInput = { workspaceRoot: "/ws", smartToolSettings: settingsSnapshot() };
    const first = ensureSmartToolConfigs(input);

    // Enabling without a usable selector would throw if the run re-resolved settings.
    input.smartToolSettings = settingsSnapshot({ enabled: true, providerId: null, modelId: null });

    expect(ensureSmartToolConfigs(input)).toEqual(first);
    expect(applySmartToolsToRecipe(recipe(), input, DESCRIPTIONS).host_tools).toContain(SEARCH_CODEBASE_TOOL);
  });

  it("fails the run when a smart tool is enabled without a usable selector model", () => {
    const input: SmartToolInput = { workspaceRoot: "/ws", smartToolSettings: settingsSnapshot({ enabled: true, providerId: null, modelId: null }) };
    expect(() => ensureSmartToolConfigs(input)).toThrow(
      "Smart code search is enabled, but no selector model is configured. Choose a provider and model or disable smart code search.",
    );
  });

  it("registers a web_extract handler only when the run enabled it", () => {
    const host = {} as RunHost;
    const noop = async () => ({ ok: true as const, output: "" });
    const off = applySmartToolHandlers({ read_file: noop }, { workspaceRoot: "/ws", readToolConfig: { mode: "complete" }, searchToolConfig: { mode: "raw" }, webExtractToolConfig: { enabled: false } }, host);
    expect(Object.keys(off)).toEqual(["read_file"]);

    const on = applySmartToolHandlers({ read_file: noop }, { workspaceRoot: "/ws", readToolConfig: { mode: "complete" }, searchToolConfig: { mode: "raw" }, webExtractToolConfig: { enabled: true, selectorModel: SELECTOR } }, host);
    expect(Object.keys(on).sort()).toEqual(["read_file", "web_extract"]);
  });
});
