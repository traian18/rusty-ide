import type { AgentChatInput } from "../../contract";
import type { CoreCapabilityDefinition } from "../CoreHarness";
import { agentChatDefinition } from "./agent_chat";
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

export const smartAgentChatDefinition: CoreCapabilityDefinition<"agent_chat"> = {
  ...agentChatDefinition,
  recipe: (input: AgentChatInput) => applySmartToolsToRecipe(agentChatDefinition.recipe!(input), input, DESCRIPTIONS),
  hostTools: (input, host, ctx, onEvent) => applySmartToolHandlers(agentChatDefinition.hostTools!(input, host, ctx, onEvent), input, host),
};
