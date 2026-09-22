import { describe, expect, it, vi } from "vitest";

import type { ExecuteNodeInput } from "../../contract";
import type { RunHost } from "../../contract";
import type { RunContext } from "../CoreHarness";
import { createTranscript } from "../transcript";
import * as exploreTools from "./exploreTools";
import { executeNodeDefinition } from "./execute_node";

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

function input(overrides: Partial<ExecuteNodeInput> = {}): ExecuteNodeInput {
  return {
    nodeId: "node-1",
    instructions: "Add a health-check endpoint.",
    model: "claude-opus-4-20250514",
    workspaceRoot: "/workspace",
    inputFiles: [],
    customProvider: {
      id: "p1",
      name: "Anthropic",
      baseUrl: "https://api.anthropic.com",
      apiKey: "sk-test",
      apiType: "anthropic-messages",
      models: [],
    },
    globalContext: "",
    contextDescriptions: [],
    chatHistory: [],
    skill: undefined,
    mcpContext: [],
    upstreamTaskContext: [],
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

const fakeHost: RunHost = {
  readFile: vi.fn(),
  writeFile: vi.fn(),
  requestPermission: vi.fn(),
};

describe("executeNodeDefinition", () => {
  it.each([
    ["openrouter", "deepseek/deepseek-v4-flash", 64_000],
    // OpenCode Zen keeps the 8192 ceiling its gateway is documented to
    // require (see the recipe()'s own comment): a real regression here
    // means an execute_node run against OpenCode Zen goes back to hanging
    // indefinitely instead of streaming a result.
    ["opencode", "minimax-m3", 8192],
  ])("routes %s through the shared tool-aware backend with its own max_tokens ceiling", (providerId, remoteId, expectedMaxTokens) => {
    const recipe = executeNodeDefinition.recipe!(input({
      model: `${providerId}/${remoteId}`,
      customProvider: {
        id: providerId, name: providerId, apiKey: "test-key",
        apiType: "openai-completions", models: [],
      },
    }));
    expect(recipe.integration).toBe("openai-compatible");
    expect(recipe.execution_params?.model).toBe(remoteId);
    expect(recipe.execution_params?.max_tokens).toBe(expectedMaxTokens);
  });

  it("supports() is true for a provider that maps to the host-routed backend with no MCP context or LSP", () => {
    expect(executeNodeDefinition.supports?.(input())).toBe(true);
  });

  it("supports() is still true when MCP context is requested (Phase 6: wired, not a bail-out any more)", () => {
    expect(executeNodeDefinition.supports?.(input({ mcpContext: [{ nodeId: "mcp-1" }] }))).toBe(true);
  });

  it("supports() is false when LSP tools are enabled -- not ported to core yet", () => {
    expect(executeNodeDefinition.supports?.(input({ lspSettings: { enabled: true } }))).toBe(false);
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
    expect(executeNodeDefinition.supports?.(withUnmapped)).toBe(false);
  });

  it("recipe() routes to the host-routed backend with the full tool set by default", () => {
    const recipe = executeNodeDefinition.recipe!(input());
    expect(recipe.integration).toBe("host");
    expect(recipe.host_tools?.map((t) => t.name).sort()).toEqual(["list_files", "open_document", "read_file", "search_codebase", "write_file"]);
    expect(recipe.execution_params).toEqual({ model: "claude-opus-4-20250514", max_tokens: 64_000, reasoning_effort: undefined });
    expect(recipe.system_prompt).toContain("bounded task executor");
    expect(recipe.system_prompt).toContain("Add a health-check endpoint.");
    expect(recipe.system_prompt).toContain("Workspace root: /workspace");
    expect(recipe.system_prompt).toContain("No input files are directly connected");
    expect(recipe.enable_web_fetch).toBe(true);
    expect(recipe.mcp_servers).toEqual([]);
  });

  it("recipe() unwraps mcpContext's {server, ...} entries into mcp_servers", () => {
    const recipe = executeNodeDefinition.recipe!(
      input({
        mcpContext: [
          {
            server: { name: "filesystem", enabled: true, transport: { type: "stdio", command: "npx", args: ["fs-mcp"] }, auth: { type: "none" }, timeout: 30000, maxRetries: 3, retryDelay: 1000 },
            nodeId: "mcp-1",
            description: "",
            nodeName: "filesystem",
          },
        ] as any,
      }),
    );
    expect(recipe.mcp_servers).toEqual([
      { name: "filesystem", transport: { kind: "stdio", command: "npx", args: ["fs-mcp"], env: undefined }, request_timeout_secs: 30 },
    ]);
  });

  it("recipe() restricts host_tools to the skill's enabledTools when set", () => {
    const recipe = executeNodeDefinition.recipe!(input({ skill: { enabledTools: ["read_file", "list_files"] } }));
    expect(recipe.host_tools?.map((t) => t.name).sort()).toEqual(["list_files", "read_file"]);
    expect(recipe.system_prompt).toContain("'read_file'");
    expect(recipe.system_prompt).not.toContain("'write_file'");
  });

  it("recipe() registers no tools when the skill's enabledTools is explicitly empty -- matching the sidecar's [] !== default quirk", () => {
    const recipe = executeNodeDefinition.recipe!(input({ skill: { enabledTools: [] } }));
    expect(recipe.host_tools).toEqual([]);
  });

  it("recipe() filters out run_command even if a skill requests it -- task nodes never get shell access", () => {
    const recipe = executeNodeDefinition.recipe!(input({ skill: { enabledTools: ["read_file", "run_command"] } }));
    expect(recipe.host_tools?.map((t) => t.name)).toEqual(["read_file"]);
  });

  it("recipe() lists the connected input files and folds upstream task output into the system prompt", () => {
    const recipe = executeNodeDefinition.recipe!(
      input({
        inputFiles: [{ path: "src/a.ts" }],
        upstreamTaskContext: [{ taskName: "Schema", prompt: "Add the table", files: [{ path: "db/schema.sql", content: "CREATE TABLE x;" }] }],
      }),
    );
    expect(recipe.system_prompt).toContain("- src/a.ts");
    expect(recipe.system_prompt).toContain("[Upstream Task: Schema]");
    expect(recipe.system_prompt).toContain("CREATE TABLE x;");
  });

  it("recipe() lists external input files with absolute paths", () => {
    const recipe = executeNodeDefinition.recipe!(
      input({
        inputFiles: [{ path: "/Users/test/external/config.yaml", name: "config.yaml" }],
      }),
    );
    expect(recipe.system_prompt).toContain("- /Users/test/external/config.yaml");
  });

  it("recipe() appends skill guidance with workspaceRoot/instructions placeholders substituted", () => {
    const recipe = executeNodeDefinition.recipe!(
      input({ skill: { systemPrompt: "Work in ${workspaceRoot} on: ${instructions}" } }),
    );
    expect(recipe.system_prompt).toContain("Work in /workspace on: Add a health-check endpoint.");
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
    expect(() => executeNodeDefinition.recipe!(withUnmapped)).toThrow(/cannot run on core/);
  });

  it("promptText() flattens prior chat history ahead of the instructions", () => {
    const text = executeNodeDefinition.promptText!(
      input({ chatHistory: [{ role: "user", content: "Use Zod for validation." }] }),
    );
    expect(text).toBe("User: Use Zod for validation.\n\nAdd a health-check endpoint.");
  });

  it("hostTools() wires read_file/write_file/list_files/search_codebase using the run's workspaceRoot and host", () => {
    const anInput = input({ workspaceRoot: "/ws" });
    const runContext = ctx();
    const tools = executeNodeDefinition.hostTools?.(anInput, fakeHost, runContext, () => {});
    expect(Object.keys(tools ?? {}).sort()).toEqual(["list_files", "open_document", "read_file", "search_codebase", "write_file"]);
    expect(exploreTools.readTool).toHaveBeenCalledWith("/ws", fakeHost, anInput.inputFiles);
    expect(exploreTools.listFilesTool).toHaveBeenCalledWith("/ws");
    expect(exploreTools.searchCodebaseTool).toHaveBeenCalledWith("/ws");
    expect(exploreTools.openDocumentTool).toHaveBeenCalledWith("/ws", anInput.inputFiles);
    expect(exploreTools.writeTool).toHaveBeenCalledWith("/ws", fakeHost, expect.any(Set), anInput.inputFiles);
  });

  it("hostTools() only wires the tools the skill's enabledTools allows", () => {
    const runContext = ctx();
    const tools = executeNodeDefinition.hostTools?.(input({ skill: { enabledTools: ["read_file"] } }), fakeHost, runContext, () => {});
    expect(Object.keys(tools ?? {})).toEqual(["read_file"]);
  });

  it("hostTools() stashes the modifiedFiles set it hands to writeTool into ctx.scratch", () => {
    const runContext = ctx();
    executeNodeDefinition.hostTools?.(input(), fakeHost, runContext, () => {});
    expect(runContext.scratch.modifiedFiles).toBeInstanceOf(Set);
  });

  it("toResult() reports the paths accumulated in ctx.scratch.modifiedFiles and the transcript's last message", () => {
    const runContext: RunContext = { scratch: { modifiedFiles: new Set(["/workspace/src/a.ts", "/workspace/src/b.ts"]) } };
    const result = executeNodeDefinition.toResult?.(transcriptWith("Added the endpoint."), input(), runContext);
    expect(result).toEqual({ modified: ["/workspace/src/a.ts", "/workspace/src/b.ts"], response: "Added the endpoint." });
  });

  it("toResult() defaults to no modified files and a fallback response when nothing was tracked", () => {
    const result = executeNodeDefinition.toResult?.(createTranscript(), input(), ctx());
    expect(result).toEqual({ modified: [], response: "Task completed." });
  });

  it("usageContext() carries the run's workspaceRoot and model", () => {
    expect(executeNodeDefinition.usageContext(input())).toEqual({ workspaceRoot: "/workspace", model: "claude-opus-4-20250514" });
  });
});
