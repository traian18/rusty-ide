import { describe, expect, it, vi } from "vitest";

import type { AgentChatInput } from "../../contract";
import type { RunHost } from "../../contract";
import type { RunContext } from "../CoreHarness";
import { createTranscript } from "../transcript";
import * as exploreTools from "./exploreTools";
import * as runCommandTool from "./runCommandTool";
import { agentChatDefinition } from "./agent_chat";

vi.mock("./runCommandTool", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./runCommandTool")>();
  return { ...actual, gatedRunCommandTool: vi.fn(() => vi.fn()) };
});

vi.mock("./exploreTools", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./exploreTools")>();
  return {
    ...actual,
    readTool: vi.fn(() => vi.fn()),
    writeTool: vi.fn(() => vi.fn()),
    listFilesTool: vi.fn(() => vi.fn()),
    searchCodebaseTool: vi.fn(() => vi.fn()),
    openDocumentTool: vi.fn(() => vi.fn()),
  };
});

function input(overrides: Partial<AgentChatInput> = {}): AgentChatInput {
  return {
    tabId: "tab-1",
    message: "Add a health-check endpoint.",
    workspaceRoot: "/workspace",
    model: "claude-opus-4-20250514",
    chatHistory: [],
    mcpServers: [],
    customProvider: {
      id: "p1",
      name: "Anthropic",
      baseUrl: "https://api.anthropic.com",
      apiKey: "sk-test",
      apiType: "anthropic-messages",
      models: [],
    },
    skill: undefined,
    planOnly: false,
    vfsOnly: false,
    lspSettings: undefined,
    ...overrides,
  };
}

function transcriptWith(text: string) {
  const transcript = createTranscript();
  transcript.push("m1", text);
  return transcript;
}

function ctx(): RunContext {
  return { scratch: {} };
}

function fakeHost(overrides: Partial<RunHost> = {}): RunHost {
  return {
    readFile: vi.fn(),
    writeFile: vi.fn(),
    requestPermission: vi.fn(),
    ...overrides,
  };
}

describe("agentChatDefinition", () => {
  it("supports() is true for a provider that maps to the host-routed backend with no MCP/LSP/planOnly/vfsOnly", () => {
    expect(agentChatDefinition.supports?.(input())).toBe(true);
  });

  it("supports() is still true when MCP servers are requested (Phase 6: wired, not a bail-out any more)", () => {
    expect(agentChatDefinition.supports?.(input({ mcpServers: [{ name: "filesystem" }] }))).toBe(true);
  });

  it("supports() is false when LSP tools are enabled -- not ported to core yet", () => {
    expect(agentChatDefinition.supports?.(input({ lspSettings: { enabled: true } }))).toBe(false);
  });

  it("supports() is still true for planOnly (sidecar-removal Phase 7d: wired, not a bail-out any more)", () => {
    expect(agentChatDefinition.supports?.(input({ planOnly: true }))).toBe(true);
  });

  it("supports() is still true for vfsOnly (sidecar-removal Phase 7d: wired, not a bail-out any more)", () => {
    expect(agentChatDefinition.supports?.(input({ vfsOnly: true }))).toBe(true);
  });

  it("supports() is false for an unsupported provider", () => {
    const withUnmapped = input({
      customProvider: {
        id: "p1",
        name: "Codex",
        baseUrl: "",
        apiKey: "",
        apiType: "openai-completions",
        transport: "some-future-sdk" as any, // codex/claude-code/copilot are now core-supported (Phase 3); this simulates a transport core does not recognize yet
        models: [],
      },
    });
    expect(agentChatDefinition.supports?.(withUnmapped)).toBe(false);
  });

  it("recipe() routes to the host-routed backend with the full tool set by default", () => {
    const recipe = agentChatDefinition.recipe!(input());
    expect(recipe.integration).toBe("host");
    expect(recipe.host_tools?.map((t) => t.name).sort()).toEqual([
      "ask_user_question",
      "list_files",
      "open_document",
      "read_file",
      "report_progress",
      "run_command",
      "search_codebase",
      "web_search",
      "write_file",
    ]);
    expect(recipe.system_prompt).toContain("'run_command'");
    expect(recipe.execution_params).toEqual({ model: "claude-opus-4-20250514", max_tokens: 64_000, reasoning_effort: undefined });
    expect(recipe.system_prompt).toContain("AI coding agent");
    expect(recipe.system_prompt).toContain("Workspace root: /workspace");
    expect(recipe.system_prompt).toContain("'report_progress'");
    expect(recipe.system_prompt).toContain("'ask_user_question'");
    expect(recipe.enable_web_fetch).toBe(true);
    expect(recipe.enable_agent_spawn).toBe(true);
    expect(recipe.mcp_servers).toEqual([]);
  });

  it("recipe() maps mcpServers into mcp_servers, dropping unmappable ones", () => {
    const recipe = agentChatDefinition.recipe!(
      input({
        mcpServers: [
          { name: "filesystem", enabled: true, transport: { type: "stdio", command: "npx", args: ["fs-mcp"] }, auth: { type: "none" }, timeout: 30000, maxRetries: 3, retryDelay: 1000 },
          { name: "broken", enabled: true, transport: { type: "websocket", url: "wss://example.test" }, auth: { type: "none" }, timeout: 30000, maxRetries: 3, retryDelay: 1000 },
        ] as any,
      }),
    );
    expect(recipe.mcp_servers).toEqual([
      { name: "filesystem", transport: { kind: "stdio", command: "npx", args: ["fs-mcp"], env: undefined }, request_timeout_secs: 30 },
    ]);
  });

  it("recipe() restricts host_tools to the skill's enabledTools but always keeps report_progress/ask_user_question", () => {
    const recipe = agentChatDefinition.recipe!(input({ skill: { enabledTools: ["read_file"] } }));
    expect(recipe.host_tools?.map((t) => t.name).sort()).toEqual(["ask_user_question", "read_file", "report_progress"]);
  });

  it("recipe() still offers report_progress/ask_user_question when the skill's enabledTools is explicitly empty", () => {
    const recipe = agentChatDefinition.recipe!(input({ skill: { enabledTools: [] } }));
    expect(recipe.host_tools?.map((t) => t.name).sort()).toEqual(["ask_user_question", "report_progress"]);
  });

  it("recipe() appends skill guidance to the system prompt", () => {
    const recipe = agentChatDefinition.recipe!(input({ skill: { systemPrompt: "Always use Zod for validation." } }));
    expect(recipe.system_prompt).toContain("Active skill guidance");
    expect(recipe.system_prompt).toContain("Always use Zod for validation.");
  });

  it("recipe() throws for an unsupported provider", () => {
    const withUnmapped = input({
      customProvider: {
        id: "p1",
        name: "Codex",
        baseUrl: "",
        apiKey: "",
        apiType: "openai-completions",
        transport: "some-future-sdk" as any, // codex/claude-code/copilot are now core-supported (Phase 3); this simulates a transport core does not recognize yet
        models: [],
      },
    });
    expect(() => agentChatDefinition.recipe!(withUnmapped)).toThrow(/cannot run on core/);
  });

  it("recipe() drops write_file/run_command and adds write_plan for planOnly, and appends the task-dependency policy", () => {
    const recipe = agentChatDefinition.recipe!(input({ planOnly: true }));
    const toolNames = recipe.host_tools?.map((t) => t.name).sort();
    expect(toolNames).toContain("write_plan");
    expect(toolNames).not.toContain("write_file");
    expect(toolNames).not.toContain("run_command");
    expect(recipe.system_prompt).toContain("Task Dependencies and Influence");
    expect(recipe.system_prompt).not.toContain("'run_command'");
  });

  it("recipe() drops run_command (and has no write_plan) but keeps write_file for vfsOnly", () => {
    const recipe = agentChatDefinition.recipe!(input({ vfsOnly: true }));
    const toolNames = recipe.host_tools?.map((t) => t.name).sort();
    expect(toolNames).toContain("write_file");
    expect(toolNames).not.toContain("write_plan");
    expect(toolNames).not.toContain("run_command");
    expect(recipe.system_prompt).not.toContain("Task Dependencies and Influence");
  });

  it("recipe() omits run_command when the skill's enabledTools leaves it out", () => {
    const recipe = agentChatDefinition.recipe!(input({ skill: { enabledTools: ["read_file", "web_search"] } }));
    expect(recipe.host_tools?.map((t) => t.name).sort()).toEqual(["ask_user_question", "read_file", "report_progress", "web_search"]);
  });

  it("promptText() flattens prior chat history ahead of the message", () => {
    const text = agentChatDefinition.promptText!(input({ chatHistory: [{ role: "user", content: "Use Zod." }] }));
    expect(text).toBe("User: Use Zod.\n\nAdd a health-check endpoint.");
  });

  it("hostTools() wires read_file/write_file/list_files/search_codebase using the run's workspaceRoot and host", () => {
    const host = fakeHost();
    const runContext = ctx();
    const tools = agentChatDefinition.hostTools?.(input({ workspaceRoot: "/ws" }), host, runContext, () => {});
    expect(Object.keys(tools ?? {}).sort()).toEqual([
      "ask_user_question",
      "list_files",
      "open_document",
      "read_file",
      "report_progress",
      "run_command",
      "search_codebase",
      "web_search",
      "write_file",
    ]);
    expect(exploreTools.readTool).toHaveBeenCalledWith("/ws", host);
    expect(exploreTools.listFilesTool).toHaveBeenCalledWith("/ws");
    expect(exploreTools.searchCodebaseTool).toHaveBeenCalledWith("/ws");
    expect(exploreTools.openDocumentTool).toHaveBeenCalledWith("/ws");
    expect(exploreTools.writeTool).toHaveBeenCalledWith("/ws", host, expect.any(Set));
  });

  it("hostTools() builds run_command against the tab's session so grants span the conversation", () => {
    const tools = agentChatDefinition.hostTools?.(input({ workspaceRoot: "/ws", tabId: "tab-9" }), fakeHost(), ctx(), () => {});
    expect(runCommandTool.gatedRunCommandTool).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceRoot: "/ws", sessionId: "tab-9" }),
    );
    expect(tools?.run_command).toBeTypeOf("function");
  });

  it("hostTools() has no run_command for planOnly or vfsOnly", () => {
    for (const mode of [{ planOnly: true }, { vfsOnly: true }]) {
      const tools = agentChatDefinition.hostTools?.(input(mode), fakeHost(), ctx(), () => {});
      expect(tools).not.toHaveProperty("run_command");
    }
  });

  it("report_progress emits a conversation progress event with the summary and next action", async () => {
    const events: unknown[] = [];
    const tools = agentChatDefinition.hostTools?.(input(), fakeHost(), ctx(), (event) => events.push(event));
    const outcome = await tools?.report_progress({ summary: "Found the router.", nextAction: "Add the route." }, new AbortController().signal);
    expect(events).toEqual([{ kind: "progress", content: "Found the router.\n\nNext: Add the route." }]);
    expect(outcome).toEqual({ ok: true, output: "Progress update shown to the user." });
  });

  it("ask_user_question forwards to host.askQuestion and returns the trimmed answer", async () => {
    const askQuestion = vi.fn().mockResolvedValue("  Use option B.  ");
    const host = fakeHost({ askQuestion });
    const tools = agentChatDefinition.hostTools?.(input(), host, ctx(), () => {});
    const signal = new AbortController().signal;
    const outcome = await tools?.ask_user_question(
      { question: "Which approach?", options: [{ label: "A" }, { label: "B", description: "safer" }] },
      signal,
    );
    expect(askQuestion).toHaveBeenCalledWith(
      { requestId: expect.any(String), question: "Which approach?", options: [{ label: "A" }, { label: "B", description: "safer" }] },
      signal,
    );
    expect(outcome).toEqual({ ok: true, output: "Use option B." });
  });

  it("ask_user_question filters out options with no label and caps at 4", async () => {
    const askQuestion = vi.fn().mockResolvedValue("ok");
    const host = fakeHost({ askQuestion });
    const tools = agentChatDefinition.hostTools?.(input(), host, ctx(), () => {});
    await tools?.ask_user_question(
      { question: "q", options: [{ label: "" }, { label: "1" }, { label: "2" }, { label: "3" }, { label: "4" }, { label: "5" }] },
      new AbortController().signal,
    );
    expect(askQuestion).toHaveBeenCalledWith(
      expect.objectContaining({ options: [{ label: "1" }, { label: "2" }, { label: "3" }, { label: "4" }] }),
      expect.anything(),
    );
  });

  it("ask_user_question fails gracefully when the host has no askQuestion implementation", async () => {
    const tools = agentChatDefinition.hostTools?.(input(), fakeHost(), ctx(), () => {});
    const outcome = await tools?.ask_user_question({ question: "q" }, new AbortController().signal);
    expect(outcome).toEqual({ ok: false, error: "This session cannot ask the user a question." });
  });

  it("write_plan normalizes the filename, calls host.writePlan, and reports the saved path", async () => {
    const writePlan = vi.fn().mockResolvedValue("/workspace/plans/my-plan.md");
    const host = fakeHost({ writePlan });
    const tools = agentChatDefinition.hostTools?.(input({ planOnly: true }), host, ctx(), () => {});
    const signal = new AbortController().signal;

    const outcome = await tools?.write_plan({ filename: "my-plan", content: "# Plan" }, signal);

    expect(writePlan).toHaveBeenCalledWith("my-plan.md", "# Plan", signal);
    expect(outcome).toEqual({ ok: true, output: "Plan saved to: /workspace/plans/my-plan.md" });
  });

  it("write_plan rejects a filename that isn't a safe Markdown name", async () => {
    const host = fakeHost({ writePlan: vi.fn() });
    const tools = agentChatDefinition.hostTools?.(input({ planOnly: true }), host, ctx(), () => {});
    const outcome = await tools?.write_plan({ filename: "../escape", content: "# Plan" }, new AbortController().signal);
    expect(outcome).toEqual({ ok: false, error: expect.stringContaining("letters, numbers, hyphens, or underscores") });
  });

  it("write_plan fails gracefully when the host has no writePlan implementation", async () => {
    const tools = agentChatDefinition.hostTools?.(input({ planOnly: true }), fakeHost(), ctx(), () => {});
    const outcome = await tools?.write_plan({ filename: "plan", content: "x" }, new AbortController().signal);
    expect(outcome).toEqual({ ok: false, error: "This session cannot save a plan file." });
  });

  it("toResult() reports modified files and the transcript's last message", () => {
    const runContext: RunContext = { scratch: { modifiedFiles: new Set(["/workspace/src/a.ts"]) } };
    const result = agentChatDefinition.toResult?.(transcriptWith("Added the endpoint."), input(), runContext);
    expect(result).toEqual({ response: "Added the endpoint.", modifiedFiles: ["/workspace/src/a.ts"], subagents: [] });
  });

  it("toResult() defaults to no modified files, empty subagents, and a fallback response", () => {
    const result = agentChatDefinition.toResult?.(createTranscript(), input(), ctx());
    expect(result).toEqual({ response: "Task completed.", modifiedFiles: [], subagents: [] });
  });

  it("usageContext() carries the run's workspaceRoot and model", () => {
    expect(agentChatDefinition.usageContext(input())).toEqual({ workspaceRoot: "/workspace", model: "claude-opus-4-20250514" });
  });

  it("recipe() configures subprocess backends without host tools or fake tool prompts", () => {
    const claudeInput = input({
      customProvider: {
        id: "claude-code",
        name: "Claude Code",
        transport: "anthropic-claude-agent-sdk",
        models: [{ id: "claude-3-5-sonnet", name: "Claude 3.5 Sonnet" }],
      } as any,
      model: "claude-3-5-sonnet",
    });
    const recipe = agentChatDefinition.recipe!(claudeInput);
    expect(recipe.integration).toBe("claude-code");
    expect(recipe.host_tools).toEqual([]);
    expect(recipe.enable_web_fetch).toBe(false);
    expect(recipe.enable_agent_spawn).toBe(false);
    expect(recipe.system_prompt).toContain("Workspace root: /workspace");
    expect(recipe.system_prompt).not.toContain("You have access to tools:");
    expect(recipe.system_prompt).not.toContain("'read_file'");
  });
});
