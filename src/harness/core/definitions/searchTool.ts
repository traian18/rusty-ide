import { NOOP_TOOL_EXECUTION_OBSERVER } from "../../contract/observability";
import type { HostToolHandler } from "../CoreHarness";
import type { HostToolSpec } from "../SessionRecipe";
import type { SearchToolRunConfig } from "../searchToolConfig";
import { RoutedSelectorModelInvoker, type SelectorModelInvoker } from "../semanticRead/modelInvoker";
import { DEFAULT_MAX_RESULTS, MAX_RESULTS_LIMIT, semanticSearch, smartSearchTracer } from "../semanticSearch/semanticSearch";
import { searchService, type SearchMatch } from "../../../services/searchService";
import { SEARCH_CODEBASE_TOOL, searchCodebaseTool } from "./exploreTools";

export const RANKED_SEARCH_CODEBASE_TOOL: HostToolSpec = {
  name: "search_codebase",
  description:
    "Find the code relevant to a described need. Describe what you are trying to locate: the behavior, symbols, error messages, or data flow. Returns the most relevant matching lines as file paths with line numbers, ranked and limited in size, for follow-up read_file calls. If the results are insufficient, search again with a more specific description or a narrower path.",
  input_schema: {
    type: "object",
    properties: {
      request: { type: "string", description: "Precisely describe the code you are trying to locate." },
      path: { type: "string", description: "Optional workspace-relative directory or file to limit the search to." },
      include: { type: "string", description: "Optional file glob filter, e.g. \"*.ts\" or \"src/**/*.rs\"." },
      max_results: { type: "integer", minimum: 1, maximum: MAX_RESULTS_LIMIT, description: `Optional result limit (default ${DEFAULT_MAX_RESULTS}).` },
    },
    required: ["request"],
    additionalProperties: false,
  },
};

export interface SearchCodebaseToolDependencies {
  workspaceRoot: string;
  selectorInvoker?: SelectorModelInvoker;
  search?: (pattern: string, isRegex: boolean) => Promise<SearchMatch[]>;
}

export interface ResolvedSearchCodebaseTool {
  spec: HostToolSpec;
  handler: HostToolHandler;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export function resolveSearchCodebaseTool(config: SearchToolRunConfig | undefined, dependencies: SearchCodebaseToolDependencies): ResolvedSearchCodebaseTool {
  if (!config || config.mode === "raw") {
    return { spec: SEARCH_CODEBASE_TOOL, handler: searchCodebaseTool(dependencies.workspaceRoot) };
  }
  const selectorModel = config.selectorModel;
  const selectorProvider = selectorModel?.provider;
  if (!selectorModel || !selectorProvider) {
    throw new Error("Smart code search is enabled, but no selector model is configured. Choose a provider and model or disable smart code search.");
  }
  const invoker = dependencies.selectorInvoker ?? new RoutedSelectorModelInvoker();
  const search = dependencies.search ?? ((pattern: string, isRegex: boolean) =>
    searchService.searchProject({ rootDir: dependencies.workspaceRoot, query: pattern, matchCase: false, wholeWord: false, isRegex }));
  const selector = { providerId: selectorModel.providerId, modelId: selectorModel.modelId };

  return {
    spec: RANKED_SEARCH_CODEBASE_TOOL,
    handler: async (args, signal, observer = NOOP_TOOL_EXECUTION_OBSERVER) => {
      const trace = smartSearchTracer(dependencies.workspaceRoot, observer);
      const parsed = (args && typeof args === "object" ? args : {}) as Record<string, unknown>;
      const request = optionalString(parsed.request);
      if (!request) {
        trace.warn("search_codebase rejected: missing request", { args });
        return { ok: false, error: "search_codebase requires a precise request describing the code to locate." };
      }
      const maxResults = typeof parsed.max_results === "number" && Number.isFinite(parsed.max_results) ? parsed.max_results : undefined;
      observer.executedBy({
        kind: "model",
        purpose: "Smart Search selector",
        model: selector.modelId,
        provider: selectorProvider.name || selector.providerId,
        providerId: selector.providerId,
      });
      try {
        const output = await semanticSearch({
          workspaceRoot: dependencies.workspaceRoot,
          request,
          path: optionalString(parsed.path),
          include: optionalString(parsed.include),
          maxResults,
          selector: { ...selector, provider: selectorProvider },
          invoker,
          search,
          signal,
          observer,
        });
        return { ok: true, output };
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        trace.warn("smart search_codebase failed", { request, selector, error: message });
        return { ok: false, error: message };
      }
    },
  };
}
