import type { AgentChatInput } from "../../contract";
import type { CustomProvider } from "../../../store/types";
import type { CoreCapabilityDefinition } from "../CoreHarness";
import { agentChatDefinition } from "./agent_chat";
import { applyDecideToolHandler, applyDecideToolToRecipe } from "./decideTool";
import { executionObservability } from "../../../observability/executionStore";
import { jevSelectionRecord } from "../../../observability/modelSelectionRecord";
import { agentChatBoundary, agentChatSwitched } from "./flowSwitching";
import { createRiskReview } from "./riskReview";
import { prepareStepRequest } from "./stepModelSelection";
import { applySmartToolHandlers, applySmartToolsToRecipe, type SmartToolDescriptions } from "./smartTools";

const DESCRIPTIONS: SmartToolDescriptions = {
  read: {
    complete: "- 'read_file': Read any file in the workspace (input: {\"path\": \"file/path\"}).",
    semantic: "- 'read_file': Read relevant excerpts from a file (input: {\"path\": \"file/path\", \"request\": \"precise description of needed symbols, behavior, dependencies, or implementation details\"}). The result may be partial; ask again with a more specific request if needed.",
  },
  search: {
    raw: "- 'search_codebase': Search for text patterns across the codebase (input: {\"pattern\": \"search text\"}).",
    ranked: "- 'search_codebase': Find the code relevant to a described need (input: {\"request\": \"what you are trying to locate: behavior, symbols, errors, or data flow\", \"path\"?: \"src/\", \"include\"?: \"*.ts\", \"max_results\"?: 30}). Returns ranked file:line matches for follow-up read_file calls; search again with a more specific request or narrower path if needed.",
  },
  webExtract: {
    after: "- 'web_fetch': Fetch the contents of a URL when the user references external documentation or a webpage.",
    line: "- 'web_extract': Extract only the parts of a web page relevant to a question (input: {\"url\": \"https://...\", \"request\": \"precise description of the information needed\"}). Returns verbatim excerpts with the source URL; prefer it over web_fetch when you need specific information from a long page.",
  },
};

/** The base handlers, with risky writes and commands reviewed by JEV when the run enables it. */
function reviewedHostTools(...[input, host, ctx, onEvent]: Parameters<NonNullable<typeof agentChatDefinition.hostTools>>) {
  if (!input.jevRiskReview) return agentChatDefinition.hostTools!(input, host, ctx, onEvent);
  const review = createRiskReview({
    config: input.jevRiskReview,
    userRequest: input.message,
    capability: "agent_chat",
    model: input.model,
    workspaceRoot: input.workspaceRoot,
  });
  return review.wrap(agentChatDefinition.hostTools!(input, review.host(host), ctx, onEvent), host);
}

/** Planning-only chat produces a plan, not decisions to act on. */
const decideConfig = (input: AgentChatInput) => (input.planOnly ? undefined : input.jevDecisionTool);

export const smartAgentChatDefinition: CoreCapabilityDefinition<"agent_chat"> = {
  ...agentChatDefinition,
  // A workflow run the chat lets hand over holds after each step and asks the flow router whether to carry on.
  switchesFlows: (input) => Boolean(input.workflow && input.flowSwitching && input.flowSwitching.targets.length > 0),
  workflowBoundary: agentChatBoundary,
  workflowSwitched: (outcome, _input, ctx) => agentChatSwitched(outcome, ctx),
  // An AUTO workflow run rates each step on its own and runs it on that level's model.
  prepareExecution: (request, input, ctx, onEvent, signal) => {
    if (!input.autoStepModels || !input.workflow) return request;
    const step = typeof ctx.scratch.workflowStep === "string" ? ctx.scratch.workflowStep : undefined;
    return prepareStepRequest({
      request,
      config: input.autoStepModels,
      provider: input.customProvider as CustomProvider | undefined,
      baseModel: input.model,
      step,
      scratch: ctx.scratch,
      signal,
      onEvent,
      onTrace: (trace) => executionObservability.recordStandalone(
        jevSelectionRecord(trace, { tabId: input.tabId, workspaceRoot: input.workspaceRoot, step }),
      ),
    });
  },
  recipe: (input: AgentChatInput) => applyDecideToolToRecipe(
    applySmartToolsToRecipe(agentChatDefinition.recipe!(input), input, DESCRIPTIONS),
    decideConfig(input),
  ),
  hostTools: (input, host, ctx, onEvent) => applyDecideToolHandler(
    applySmartToolHandlers(reviewedHostTools(input, host, ctx, onEvent), input, host),
    {
      config: decideConfig(input),
      userRequest: input.message,
      capability: "agent_chat",
      model: input.model,
      host,
      ctx,
      provider: input.customProvider as CustomProvider | undefined,
      log: (message) => onEvent({ kind: "log", message }),
    },
  ),
};
