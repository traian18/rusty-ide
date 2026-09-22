import { describe, expect, it, vi } from "vitest";

import type { GlobalExploreInput } from "../../contract";
import type { RunHost } from "../../contract";
import { createTranscript } from "../transcript";
import * as exploreTools from "./exploreTools";
import { EXPLORE_TOOLS } from "./exploreTools";
import { globalExploreDefinition } from "./global_explore";

vi.mock("./exploreTools", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./exploreTools")>();
  return {
    ...actual,
    readTool: vi.fn(() => vi.fn()),
    listFilesTool: vi.fn(() => vi.fn()),
    searchCodebaseTool: vi.fn(() => vi.fn()),
    openDocumentTool: vi.fn(() => vi.fn()),
  };
});

function input(overrides: Partial<GlobalExploreInput> = {}): GlobalExploreInput {
  return {
    nodeId: "node-1",
    prompt: "Summarize the architecture.",
    workspaceRoot: "/workspace",
    model: "claude-opus-4-20250514",
    chatHistory: [],
    customProvider: {
      id: "p1",
      name: "Anthropic",
      baseUrl: "https://api.anthropic.com",
      apiKey: "sk-test",
      apiType: "anthropic-messages",
      models: [],
    },
    ...overrides,
  };
}

function transcriptWith(text: string) {
  const transcript = createTranscript();
  transcript.push("m1", text);
  return transcript;
}

const fakeHost: RunHost = {
  readFile: vi.fn(),
  writeFile: vi.fn(),
  requestPermission: vi.fn(),
};

describe("globalExploreDefinition", () => {
  it("supports() is true for a provider that maps to the host-routed backend with no MCP servers", () => {
    expect(globalExploreDefinition.supports?.(input())).toBe(true);
  });

  it("supports() is still true when MCP servers are requested (Phase 6: wired, not a bail-out any more)", () => {
    expect(globalExploreDefinition.supports?.(input({ mcpServers: [{ name: "filesystem" }] }))).toBe(true);
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
    expect(globalExploreDefinition.supports?.(withUnmapped)).toBe(false);
  });

  it("recipe() routes to the host-routed backend with the explore toolset and the system prompt", () => {
    const recipe = globalExploreDefinition.recipe!(input());
    expect(recipe.integration).toBe("host");
    expect(recipe.host_tools).toBe(EXPLORE_TOOLS);
    expect(recipe.execution_params).toEqual({ model: "claude-opus-4-20250514", max_tokens: 64_000, reasoning_effort: undefined });
    expect(recipe.system_prompt).toContain("codebase exploration assistant");
    expect(recipe.system_prompt).toContain("Workspace root: /workspace");
  });

  it("recipe() enables web.fetch and maps mcpServers into mcp_servers, dropping unmappable ones", () => {
    const recipe = globalExploreDefinition.recipe!(
      input({
        mcpServers: [
          { name: "filesystem", enabled: true, transport: { type: "stdio", command: "npx", args: ["fs-mcp"] }, auth: { type: "none" }, timeout: 30000, maxRetries: 3, retryDelay: 1000 },
          { name: "broken", enabled: true, transport: { type: "websocket", url: "wss://example.test" }, auth: { type: "none" }, timeout: 30000, maxRetries: 3, retryDelay: 1000 },
        ] as any,
      }),
    );
    expect(recipe.enable_web_fetch).toBe(true);
    expect(recipe.mcp_servers).toEqual([
      { name: "filesystem", transport: { kind: "stdio", command: "npx", args: ["fs-mcp"], env: undefined }, request_timeout_secs: 30 },
    ]);
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
    expect(() => globalExploreDefinition.recipe!(withUnmapped)).toThrow(/cannot run on core/);
  });

  it("promptText() is just the prompt when there's no chat history and planOnly is unset", () => {
    expect(globalExploreDefinition.promptText!(input())).toBe("Summarize the architecture.");
  });

  it("promptText() flattens prior chat history ahead of the prompt", () => {
    const text = globalExploreDefinition.promptText!(
      input({ chatHistory: [{ role: "user", content: "What is this repo?" }, { role: "assistant", content: "A Tauri IDE." }] }),
    );
    expect(text).toBe("User: What is this repo?\n\nAssistant: A Tauri IDE.\n\nSummarize the architecture.");
  });

  it("promptText() wraps the prompt with plan-only instructions when planOnly is set", () => {
    const text = globalExploreDefinition.promptText!(input({ planOnly: true }));
    expect(text).toContain("PLANNING AND ANALYSIS assistant");
    expect(text).toContain("Summarize the architecture.");
  });

  it("hostTools() wires read/list_files/search_codebase/open_document from exploreTools using the run's workspaceRoot and host", () => {
    const anInput = input({ workspaceRoot: "/ws" });
    const tools = globalExploreDefinition.hostTools?.(anInput, fakeHost, { scratch: {} }, () => {});
    expect(Object.keys(tools ?? {}).sort()).toEqual(["list_files", "open_document", "read", "search_codebase"]);
    expect(exploreTools.readTool).toHaveBeenCalledWith("/ws", fakeHost);
    expect(exploreTools.listFilesTool).toHaveBeenCalledWith("/ws");
    expect(exploreTools.searchCodebaseTool).toHaveBeenCalledWith("/ws");
    expect(exploreTools.openDocumentTool).toHaveBeenCalledWith("/ws");
  });

  it("toResult() extracts the trailing '--- SUMMARY ---' section", () => {
    const response = "# Architecture\n\nSome analysis.\n\n--- SUMMARY ---\n- Uses Zustand\n- Uses Tauri";
    const result = globalExploreDefinition.toResult?.(transcriptWith(response), input(), { scratch: {} });
    expect(result).toEqual({ response, summary: "- Uses Zustand\n- Uses Tauri" });
  });

  it("toResult() leaves summary undefined when there's no marked section", () => {
    const response = "Just a plain response with no summary marker.";
    const result = globalExploreDefinition.toResult?.(transcriptWith(response), input(), { scratch: {} });
    expect(result).toEqual({ response, summary: undefined });
  });

  it("toResult() falls back to a default response when the transcript is empty", () => {
    const result = globalExploreDefinition.toResult?.(createTranscript(), input(), { scratch: {} });
    expect(result).toEqual({ response: "Exploration completed.", summary: undefined });
  });

  it("usageContext() carries the run's workspaceRoot and model", () => {
    expect(globalExploreDefinition.usageContext(input())).toEqual({ workspaceRoot: "/workspace", model: "claude-opus-4-20250514" });
  });
});
