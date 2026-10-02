import { CHAT_RENDER_CHARS } from "../../../config/chatLimits";
import { describe, expect, it, vi } from "vitest";

import type { AgentChatInput } from "../../contract";
import type { RunHost } from "../../contract";
import type { RunContext } from "../CoreHarness";
import { createTranscript } from "../transcript";
import * as exploreTools from "./exploreTools";
import * as runCommandTool from "./runCommandTool";
import type { ProjectFs } from "../projectInfo";
import { scanProject } from "../projectScan";
import { agentChatDefinition, longResponseGuideline } from "./agent_chat";
import { BUILT_IN_SKILLS, BUILT_IN_SKILL_IDS, toSkillData } from "../../../config/skillDefinitions";

vi.mock("./runCommandTool", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./runCommandTool")>();
  return { ...actual, gatedRunCommandTool: vi.fn(() => vi.fn()) };
});

vi.mock("../projectScan", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../projectScan")>();
  return { ...actual, scanProject: vi.fn() };
});

vi.mock("./exploreTools", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./exploreTools")>();
  return {
    ...actual,
    readTool: vi.fn(() => vi.fn()),
    editTool: vi.fn(() => vi.fn()),
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
  it("passes custom skill grants to the harness independently of the provider and mode", () => {
    for (const transport of ["http", "openai-codex-app-server", "github-copilot-sdk"]) {
      const recipe = agentChatDefinition.recipe!(input({
        customProvider: { ...(input().customProvider as any), transport },
        planOnly: true,
        skill: { enabledTools: ["read_file", "write_file"], mcpServers: ["docs"] },
      }));
      expect(recipe.execution_policy).toEqual({ mode: "plan", enabled_tools: ["read_file", "write_file"], allowed_mcp_servers: ["docs"] });
    }
  });
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
        transport: "some-future-sdk" as any, // codex/copilot are now core-supported (Phase 3); this simulates a transport core does not recognize yet
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
      "edit_file",
      "install_dependencies",
      "list_files",
      "open_document",
      "project_info",
      "read_file",
      "report_progress",
      "run_check",
      "run_command",
      "search_codebase",
      "web_search",
      "write_file",
    ]);
    expect(recipe.system_prompt).toContain("'run_command'");
    expect(recipe.execution_params).toEqual({ model: "claude-opus-4-20250514", max_tokens: 128_000, reasoning_effort: undefined });
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

  it("recipe() honors Atlassian ticked on the Plan skill: granted, read-only, and named with the skill", () => {
    const atlassian = {
      name: "atlassian",
      displayName: "Atlassian MCP (Hosted)",
      enabled: true,
      transport: { type: "http", url: "https://mcp.atlassian.com/v2/mcp" },
      auth: { type: "apiKey", header: "Authorization", value: "Basic abc" },
      timeout: 30000,
      maxRetries: 3,
      retryDelay: 1000,
    };
    const plan = BUILT_IN_SKILLS.find((skill) => skill.id === BUILT_IN_SKILL_IDS.PLAN)!;
    // Built exactly as AgentTab does, through toSkillData.
    const skill = toSkillData({ ...plan, mcpServers: ["atlassian"] });

    const recipe = agentChatDefinition.recipe!(input({ skill, planOnly: true, mcpServers: [atlassian] as any }));

    expect(recipe.execution_policy).toMatchObject({ mode: "plan", allowed_mcp_servers: ["atlassian"] });
    expect(recipe.system_prompt).toContain("Active skill: plan");
    expect(recipe.system_prompt).toContain("- atlassian: Atlassian MCP (Hosted) (read-only tools only, because of plan mode)");

    const unticked = agentChatDefinition.recipe!(input({ skill: toSkillData(plan), planOnly: true, mcpServers: [atlassian] as any }));
    expect(unticked.execution_policy?.allowed_mcp_servers).toEqual([]);
    expect(unticked.system_prompt).toContain("unavailable in this session");
  });

  it("recipe() restricts host_tools to the skill's enabledTools but always keeps report_progress/ask_user_question", () => {
    // project_info only reads manifests, so it rides on the read_file grant.
    const recipe = agentChatDefinition.recipe!(input({ skill: { enabledTools: ["read_file"] } }));
    expect(recipe.host_tools?.map((t) => t.name).sort()).toEqual(["ask_user_question", "project_info", "read_file", "report_progress"]);
  });

  it("recipe() still offers report_progress/ask_user_question when the skill's enabledTools is explicitly empty", () => {
    const recipe = agentChatDefinition.recipe!(input({ skill: { enabledTools: [] } }));
    expect(recipe.host_tools?.map((t) => t.name).sort()).toEqual(["ask_user_question", "report_progress"]);
  });

  it("recipe() appends skill guidance to the system prompt", () => {
    const recipe = agentChatDefinition.recipe!(input({ skill: { enabledTools: [], systemPrompt: "Always use Zod for validation." } }));
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
        transport: "some-future-sdk" as any, // codex/copilot are now core-supported (Phase 3); this simulates a transport core does not recognize yet
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
    expect(toolNames).not.toContain("edit_file");
    expect(toolNames).not.toContain("run_command");
    expect(recipe.system_prompt).toContain("Task Dependencies and Influence");
    expect(recipe.system_prompt).not.toContain("'run_command'");
  });

  it("recipe() drops run_command (and has no write_plan) but keeps write_file for vfsOnly", () => {
    const recipe = agentChatDefinition.recipe!(input({ vfsOnly: true }));
    const toolNames = recipe.host_tools?.map((t) => t.name).sort();
    expect(toolNames).toContain("write_file");
    expect(toolNames).toContain("edit_file");
    expect(toolNames).not.toContain("write_plan");
    expect(toolNames).not.toContain("run_command");
    expect(recipe.system_prompt).not.toContain("Task Dependencies and Influence");
  });

  it("recipe() omits run_command when the skill's enabledTools leaves it out", () => {
    const recipe = agentChatDefinition.recipe!(input({ skill: { enabledTools: ["read_file", "web_search"] } }));
    expect(recipe.host_tools?.map((t) => t.name).sort()).toEqual(["ask_user_question", "project_info", "read_file", "report_progress", "web_search"]);
  });

  it("recipe() offers project_info with the read grant and tells the model to use it before building or verifying", () => {
    const recipe = agentChatDefinition.recipe!(input({ skill: { enabledTools: ["read_file", "run_command"] } }));
    expect(recipe.host_tools?.map((t) => t.name)).toContain("project_info");
    expect(recipe.system_prompt).toContain("- 'project_info': Find out what kind of project this is");
    expect(recipe.system_prompt).toContain("Before you build, test or verify, call 'project_info'");
    expect(recipe.system_prompt).toContain("that is an environment problem");
  });

  it("recipe() offers no project_info, and no mention of it, without the read grant", () => {
    const recipe = agentChatDefinition.recipe!(input({ skill: { enabledTools: ["web_search"] } }));
    expect(recipe.host_tools?.map((t) => t.name)).not.toContain("project_info");
    expect(recipe.system_prompt).not.toContain("project_info");
  });

  it("recipe() offers run_check with the run_command grant and ties 'done' to a reported PASSED", () => {
    const recipe = agentChatDefinition.recipe!(input({ skill: { enabledTools: ["read_file", "run_command"] } }));
    const toolNames = recipe.host_tools?.map((t) => t.name);
    expect(toolNames).toEqual(expect.arrayContaining(["run_check", "install_dependencies", "run_command"]));
    expect(toolNames!.indexOf("run_check")).toBeLessThan(toolNames!.indexOf("run_command"));
    expect(recipe.system_prompt).toContain("- 'install_dependencies': Install the project's dependencies");
    expect(recipe.system_prompt).toContain("call 'install_dependencies' and run the check again instead of editing code");
    expect(recipe.system_prompt).toContain("- 'run_check': Run one of the project's own checks");
    expect(recipe.system_prompt).toContain("To verify a build, call 'run_check'");
    expect(recipe.system_prompt).toContain("Do not say something builds, passes or is fixed unless a check in this conversation reported PASSED after your last change");
  });

  it("recipe() offers no run_check, and no mention of it, without the run_command grant", () => {
    const recipe = agentChatDefinition.recipe!(input({ skill: { enabledTools: ["read_file", "write_file"] } }));
    expect(recipe.host_tools?.map((t) => t.name)).not.toContain("run_check");
    expect(recipe.host_tools?.map((t) => t.name)).not.toContain("install_dependencies");
    expect(recipe.system_prompt).not.toContain("run_check");
    expect(recipe.system_prompt).not.toContain("install_dependencies");
  });

  it("recipe() drops run_check wherever run_command is dropped: planOnly and vfsOnly", () => {
    for (const mode of [{ planOnly: true }, { vfsOnly: true }]) {
      const recipe = agentChatDefinition.recipe!(input(mode));
      const toolNames = recipe.host_tools?.map((t) => t.name);
      expect(toolNames).not.toContain("run_check");
      expect(toolNames).not.toContain("install_dependencies");
      expect(toolNames).not.toContain("run_command");
      expect(recipe.system_prompt).not.toContain("'run_check'");
      expect(recipe.system_prompt).not.toContain("'install_dependencies'");
    }
  });

  it("recipe() keeps project_info in planOnly, which only reads", () => {
    const recipe = agentChatDefinition.recipe!(input({ planOnly: true }));
    expect(recipe.host_tools?.map((t) => t.name)).toContain("project_info");
  });

  it("recipe() describes list_files with its path and glob modes", () => {
    const recipe = agentChatDefinition.recipe!(input());
    expect(recipe.system_prompt).toContain('{"glob": "**/package.json"}');
    expect(recipe.system_prompt).not.toContain("List all files in the workspace");
  });

  it("recipe() offers edit_file with the write_file grant and steers existing-file changes to it", () => {
    const recipe = agentChatDefinition.recipe!(input({ skill: { enabledTools: ["read_file", "write_file"] } }));
    const toolNames = recipe.host_tools?.map((t) => t.name);
    expect(toolNames).toContain("edit_file");
    expect(toolNames!.indexOf("edit_file")).toBeLessThan(toolNames!.indexOf("write_file"));
    expect(recipe.system_prompt).toContain("Change an existing file with 'edit_file'");
    expect(recipe.system_prompt).toContain("Use 'write_file' only to create a new file");
    expect(recipe.system_prompt).not.toContain("Use 'write_file' to write the updated content back.");
    expect(recipe.system_prompt).toContain("needs overwrite: true");
    expect(recipe.system_prompt).toContain('"overwrite"?: true');
  });

  it("recipe() offers neither edit_file nor write_file without the write_file grant", () => {
    const recipe = agentChatDefinition.recipe!(input({ skill: { enabledTools: ["read_file"] } }));
    const toolNames = recipe.host_tools?.map((t) => t.name);
    expect(toolNames).not.toContain("edit_file");
    expect(toolNames).not.toContain("write_file");
    expect(recipe.system_prompt).not.toContain("'edit_file'");
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
      "edit_file",
      "install_dependencies",
      "list_files",
      "open_document",
      "project_info",
      "read_file",
      "report_progress",
      "run_check",
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
    expect(exploreTools.editTool).toHaveBeenCalledWith("/ws", host, expect.any(Set));
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

  it("recipe() provides harness tools to subscription inference backends", () => {
    const codexInput = input({
      customProvider: {
        id: "openai-codex",
        name: "OpenAI Codex",
        transport: "openai-codex-app-server",
        models: [{ id: "gpt-5.6-sol", name: "GPT-5.6 Sol" }],
      } as any,
      model: "gpt-5.6-sol",
    });
    const recipe = agentChatDefinition.recipe!(codexInput);
    expect(recipe.integration).toBe("codex");
    expect(recipe.host_tools?.some((tool) => tool.name === "read_file")).toBe(true);
    expect(recipe.enable_web_fetch).toBe(true);
    expect(recipe.enable_agent_spawn).toBe(true);
    expect(recipe.system_prompt).toContain("Workspace root: /workspace");
    expect(recipe.system_prompt).toContain("You have access to tools:");
    expect(recipe.system_prompt).toContain("'read_file'");
  });

  it("recipe() sends a selected Copilot model's remote id and rejects a stale foreign selection", () => {
    const copilot = {
      id: "github-copilot",
      name: "GitHub Copilot",
      baseUrl: "",
      apiKey: "",
      apiType: "copilot-sdk" as const,
      transport: "github-copilot-sdk" as const,
      models: [{ id: "github-copilot/gpt-4o", remoteId: "gpt-4o", name: "GPT-4o", supported: true }],
    };
    const selected = input({ customProvider: copilot, model: "github-copilot/gpt-4o" });
    expect(agentChatDefinition.supports?.(selected)).toBe(true);
    const recipe = agentChatDefinition.recipe!(selected);
    expect(recipe.integration).toBe("github-copilot");
    expect(recipe.execution_params?.model).toBe("gpt-4o");
    expect(agentChatDefinition.supports?.(input({ customProvider: copilot, model: "openai/gpt-5.6-terra" }))).toBe(false);
  });

  it("web_search reports the search provider's model and tokens as the call's executor", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({
      model: "sonar",
      usage: { prompt_tokens: 10, completion_tokens: 90, total_tokens: 100 },
      choices: [{ message: { content: "Answer." } }],
      citations: [],
    }), { status: 200 })) as unknown as typeof fetch;
    try {
      const tools = agentChatDefinition.hostTools!(input({ webSearchApiKeys: { perplexity: "k" } }), fakeHost(), ctx(), () => {});
      const observer = { executedBy: vi.fn(), usage: vi.fn(), step: vi.fn() };

      const outcome = await tools.web_search({ query: "q", provider: "perplexity" }, new AbortController().signal, observer);

      expect(outcome.ok).toBe(true);
      expect(observer.executedBy).toHaveBeenCalledWith({ kind: "model", purpose: "Web search", model: "sonar", provider: "perplexity" });
      expect(observer.usage).toHaveBeenCalledWith({ input: 10, output: 90, totalTokens: 100 });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("tells the agent to put responses too long for the chat into a file, with the tool it actually has", () => {
    const prompt = agentChatDefinition.recipe!(input()).system_prompt ?? "";
    expect(prompt).toContain(`if a response would exceed about ${CHAT_RENDER_CHARS.toLocaleString("en-US")} characters`);
    expect(prompt).toContain("with 'write_file' instead of the chat");

    const planPrompt = agentChatDefinition.recipe!(input({ planOnly: true })).system_prompt ?? "";
    expect(planPrompt).toContain("save the complete content with 'write_plan'");

    expect(longResponseGuideline([])).toContain("give a condensed answer and offer to continue");
  });
});

describe("agentChatDefinition.enrichRecipe", () => {
  const workspace = (files: Record<string, string>, present: string[] = []): ProjectFs => ({
    files: Object.keys(files),
    read: async (path) => files[path],
    exists: async (path) => present.includes(path) || path in files,
  });
  const nodeProject = { "package.json": JSON.stringify({ scripts: { test: "vitest run", build: "vite build" }, dependencies: { react: "1" } }), "package-lock.json": "{}" };
  const enrich = (overrides: Partial<AgentChatInput> = {}) => {
    const chat = input(overrides);
    return agentChatDefinition.enrichRecipe!(agentChatDefinition.recipe!(chat), chat, fakeHost(), new AbortController().signal);
  };

  it("appends the detected projects to the system prompt, leaving everything else of the recipe alone", async () => {
    vi.mocked(scanProject).mockResolvedValue(workspace(nodeProject, ["node_modules"]));
    const plain = agentChatDefinition.recipe!(input());
    const enriched = await enrich();
    expect(enriched).toEqual({ ...plain, system_prompt: expect.stringContaining(plain.system_prompt as string) });
    expect(enriched?.system_prompt).toMatch(/Detected workspace[^\n]*\n- workspace root: node \(npm\)[^\n]*checks: test, build/);
  });

  it("scans the run's own workspace, with the run's own host", async () => {
    vi.mocked(scanProject).mockClear().mockResolvedValue(workspace(nodeProject));
    const chat = input({ workspaceRoot: "/elsewhere" });
    const host = fakeHost();
    await agentChatDefinition.enrichRecipe!(agentChatDefinition.recipe!(chat), chat, host, new AbortController().signal);
    expect(scanProject).toHaveBeenCalledWith("/elsewhere", host, expect.any(AbortSignal));
  });

  it("adds nothing, and does not scan, when the model cannot call project_info or there is no workspace", async () => {
    vi.mocked(scanProject).mockClear().mockResolvedValue(workspace(nodeProject));
    expect(await enrich({ skill: { enabledTools: ["search_codebase"] } })).toBeUndefined();
    expect(await enrich({ workspaceRoot: "  " })).toBeUndefined();
    expect(scanProject).not.toHaveBeenCalled();
  });

  it("adds nothing for a workspace with no recognizable project", async () => {
    vi.mocked(scanProject).mockResolvedValue(workspace({ "notes.txt": "hi" }));
    expect(await enrich()).toBeUndefined();
  });

  it("lets a scan failure reach the harness, which falls back to the plain recipe", async () => {
    vi.mocked(scanProject).mockRejectedValue(new Error("list_directory failed"));
    await expect(enrich()).rejects.toThrow("list_directory failed");
  });
});

describe("agentChatDefinition: running one test", () => {
  it("tells the model it can run just one test, and to run the whole check before finishing", () => {
    const prompt = agentChatDefinition.recipe!(input()).system_prompt ?? "";
    expect(prompt).toContain('"test_name"?: "name or part of one"');
    expect(prompt).toContain("run just that test with 'test_name' or 'test_file', but run the whole test check before you finish");
  });
});
