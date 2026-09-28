import { afterEach, describe, expect, it, vi } from "vitest";
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

describe("decide tool wiring", () => {
  const JEV = { apiKey: "or-key", jevModelId: "typesafe/jev-1.13" };
  const toolNames = (recipe: { host_tools?: Array<{ name: string }> }) => recipe.host_tools?.map((tool) => tool.name) ?? [];
  const host = {} as Parameters<NonNullable<typeof smartAgentChatDefinition.hostTools>>[1];

  it("is offered to agent chats and task nodes only when the run has a JEV config", () => {
    expect(toolNames(smartAgentChatDefinition.recipe!(agentInput()))).not.toContain("decide");
    expect(toolNames(smartExecuteNodeDefinition.recipe!(nodeInput()))).not.toContain("decide");

    const chat = smartAgentChatDefinition.recipe!({ ...agentInput(), jevDecisionTool: JEV });
    const node = smartExecuteNodeDefinition.recipe!({ ...nodeInput(), jevDecisionTool: JEV });
    for (const recipe of [chat, node]) {
      expect(toolNames(recipe)).toContain("decide");
      expect(recipe.system_prompt).toMatch(/Decisions:\n- You gather facts and carry out the work/);
    }
    expect(Object.keys(smartAgentChatDefinition.hostTools!({ ...agentInput(), jevDecisionTool: JEV }, host, { scratch: {} }, () => {}))).toContain("decide");
    expect(Object.keys(smartExecuteNodeDefinition.hostTools!({ ...nodeInput(), jevDecisionTool: JEV }, host, { scratch: {} }, () => {}))).toContain("decide");
  });

  it("is not offered to planning-only chats", () => {
    const input = { ...agentInput(), planOnly: true, jevDecisionTool: JEV };
    expect(toolNames(smartAgentChatDefinition.recipe!(input))).not.toContain("decide");
    expect(Object.keys(smartAgentChatDefinition.hostTools!(input, host, { scratch: {} }, () => {}))).not.toContain("decide");
  });
});

describe("risky action review wiring", () => {
  const JEV = { apiKey: "or-key", jevModelId: "typesafe/jev-1.13" };
  const ORIGINAL = Array.from({ length: 30 }, (_, index) => `const line${index} = ${index};`).join("\n");

  afterEach(() => vi.unstubAllGlobals());

  function host() {
    return {
      readFile: vi.fn(async () => ORIGINAL),
      writeFile: vi.fn(async () => {}),
      requestPermission: vi.fn(async () => "allow_once" as const),
    };
  }

  it.each([
    ["agent_chat", () => smartAgentChatDefinition.hostTools!({ ...agentInput(), jevRiskReview: JEV }, runHost, { scratch: {} }, () => {})],
    ["execute_node", () => smartExecuteNodeDefinition.hostTools!({ ...nodeInput(), jevRiskReview: JEV }, runHost, { scratch: {} }, () => {})],
  ])("%s reviews a destructive write with JEV before it reaches the file", async (_name, build) => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      answers: { action: { type: "score", confidence: 0.8, probabilities: { "0": 0.1, "1": 0.8, "2": 0.1 } } },
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    currentHost = host();

    const outcome = await build().write_file({ path: "server.ts", content: "" }, new AbortController().signal);

    expect(fetchMock).toHaveBeenCalledWith("https://openrouter.ai/api/alpha/decisions", expect.anything());
    expect(outcome).toEqual({ ok: false, error: expect.stringMatching(/^Blocked before it ran\. It empties an existing file/) });
    expect(currentHost.writeFile).not.toHaveBeenCalled();
  });

  it("leaves writes alone when the run does not enable reviews", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    currentHost = host();
    await smartAgentChatDefinition.hostTools!(agentInput(), runHost, { scratch: {} }, () => {}).write_file({ path: "server.ts", content: "" }, new AbortController().signal);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(currentHost.writeFile).toHaveBeenCalled();
  });

  let currentHost: ReturnType<typeof host>;
  // Delegates to the host of the test that is running.
  const runHost = {
    readFile: (...args: unknown[]) => (currentHost.readFile as (...a: unknown[]) => Promise<string>)(...args),
    writeFile: (...args: unknown[]) => (currentHost.writeFile as (...a: unknown[]) => Promise<void>)(...args),
    requestPermission: (...args: unknown[]) => (currentHost.requestPermission as (...a: unknown[]) => Promise<"allow_once">)(...args),
  } as unknown as Parameters<NonNullable<typeof smartAgentChatDefinition.hostTools>>[1];
});
