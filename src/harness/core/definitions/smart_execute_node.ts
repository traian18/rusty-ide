import type { ExecuteNodeInput } from "../../contract";
import type { CoreCapabilityDefinition } from "../CoreHarness";
import { executeNodeDefinition } from "./execute_node";
import { applyDecideToolHandler, applyDecideToolToRecipe } from "./decideTool";
import { createRiskReview } from "./riskReview";
import { applySmartToolHandlers, applySmartToolsToRecipe, type SmartToolDescriptions } from "./smartTools";

const DESCRIPTIONS: SmartToolDescriptions = {
  read: {
    complete: "- 'read_file': Read a file's current content before editing it.",
    semantic: "- 'read_file': Read relevant excerpts from a file before editing it. Provide a precise request describing the symbols, behavior, dependencies, or implementation details you need. If the excerpt is insufficient, request the file again with a narrower description.",
  },
  search: {
    raw: "- 'search_codebase': Find specific code patterns.",
    ranked: "- 'search_codebase': Find the code relevant to a described need. Provide a request describing the behavior, symbols, errors, or data flow to locate, optionally with a path or include glob. Returns ranked file:line matches; search again more specifically if needed.",
  },
  webExtract: {
    after: "- 'web_fetch': Fetch the contents of a URL when the task references external documentation or a webpage.",
    line: "- 'web_extract': Extract only the parts of a web page relevant to a question (input: {\"url\": \"https://...\", \"request\": \"precise description of the information needed\"}). Returns verbatim excerpts with the source URL; prefer it over web_fetch when you need specific information from a long page.",
  },
};

/** The base handlers, with risky writes reviewed by JEV when the run enables it. */
function reviewedHostTools(...[input, host, ctx, onEvent]: Parameters<NonNullable<typeof executeNodeDefinition.hostTools>>) {
  if (!input.jevRiskReview) return executeNodeDefinition.hostTools!(input, host, ctx, onEvent);
  const review = createRiskReview({
    config: input.jevRiskReview,
    userRequest: input.instructions,
    capability: "execute_node",
    model: input.model,
    workspaceRoot: input.workspaceRoot,
    inputFiles: input.inputFiles,
  });
  return review.wrap(executeNodeDefinition.hostTools!(input, review.host(host), ctx, onEvent), host);
}

export const smartExecuteNodeDefinition: CoreCapabilityDefinition<"execute_node"> = {
  ...executeNodeDefinition,
  recipe: (input: ExecuteNodeInput) => applyDecideToolToRecipe(
    applySmartToolsToRecipe(executeNodeDefinition.recipe!(input), input, DESCRIPTIONS),
    input.jevDecisionTool,
  ),
  hostTools: (input, host, ctx, onEvent) => applyDecideToolHandler(
    applySmartToolHandlers(reviewedHostTools(input, host, ctx, onEvent), input, host),
    { config: input.jevDecisionTool, userRequest: input.instructions, capability: "execute_node", model: input.model, host, ctx },
  ),
};
