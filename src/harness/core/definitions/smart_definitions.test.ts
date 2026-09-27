import { describe, expect, it } from "vitest";
import type { AgentChatInput, ExecuteNodeInput } from "../../contract";
import type { CustomProvider } from "../../../store/types";
import { smartAgentChatDefinition } from "./smart_agent_chat";
import { smartExecuteNodeDefinition } from "./smart_execute_node";

const SELECTOR = { providerId: "sel", modelId: "m", provider: { id: "sel", name: "Sel" } as CustomProvider };
const SMART = {
  readToolConfig: { mode: "semantic" as const, selectorModel: SELECTOR },
  searchToolConfig: { mode: "ranked" as const, selectorModel: SELECTOR },
  webExtractToolConfig: { enabled: true, selectorModel: SELECTOR },
};
const PROVIDER = { id: "p1", name: "Anthropic", baseUrl: "https://api.anthropic.com", apiKey: "sk-test", apiType: "anthropic-messages", models: [] };

const agentInput = (): AgentChatInput => ({
  tabId: "tab-1", message: "Add a health-check endpoint.", workspaceRoot: "/workspace", model: "claude-opus-4-20250514",
  chatHistory: [], mcpServers: [], customProvider: PROVIDER, skill: undefined, planOnly: false, vfsOnly: false, lspSettings: undefined,
  ...SMART,
});

const nodeInput = (): ExecuteNodeInput => ({
  nodeId: "node-1", instructions: "Add a health-check endpoint.", model: "claude-opus-4-20250514", workspaceRoot: "/workspace",
  inputFiles: [], customProvider: PROVIDER, globalContext: "", contextDescriptions: [], chatHistory: [], skill: undefined,
  mcpContext: [], upstreamTaskContext: [], lspSettings: undefined,
  ...SMART,
});

// Guards the exact-text replacement: if a base definition rewords its tool
// line, the smart description would silently stop being applied.
describe.each([
  ["agent_chat", () => smartAgentChatDefinition.recipe!(agentInput())],
  ["execute_node", () => smartExecuteNodeDefinition.recipe!(nodeInput())],
])("%s smart tool descriptions", (_name, build) => {
  it("describes the request-based read_file and search_codebase contracts in the system prompt", () => {
    const prompt = build().system_prompt ?? "";
    const searchLine = prompt.split("\n").find((line) => line.startsWith("- 'search_codebase'"));
    const readLine = prompt.split("\n").find((line) => line.startsWith("- 'read_file'"));
    expect(searchLine).toMatch(/described need/);
    expect(readLine).toMatch(/relevant excerpts/);
    const lines = prompt.split("\n");
    const fetchIndex = lines.findIndex((line) => line.startsWith("- 'web_fetch'"));
    expect(lines[fetchIndex + 1]).toMatch(/^- 'web_extract': Extract only the parts of a web page/);
    expect(build().host_tools?.map((tool) => tool.name)).toContain("web_extract");
    expect(prompt).not.toMatch(/selector/i);
  });
});
