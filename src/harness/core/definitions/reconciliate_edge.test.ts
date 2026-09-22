import { describe, expect, it, vi } from "vitest";

import type { ReconciliateEdgeInput } from "../../contract";
import type { RunHost } from "../../contract";
import { createTranscript } from "../transcript";
import * as exploreTools from "./exploreTools";
import { reconciliateEdgeDefinition } from "./reconciliate_edge";

vi.mock("./exploreTools", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./exploreTools")>();
  return {
    ...actual,
    readTool: vi.fn(() => vi.fn()),
    writeTool: vi.fn(() => vi.fn()),
    listFilesTool: vi.fn(() => vi.fn()),
    searchCodebaseTool: vi.fn(() => vi.fn()),
  };
});

function input(overrides: Partial<ReconciliateEdgeInput> = {}): ReconciliateEdgeInput {
  return {
    edgeId: "edge-1",
    sourceTaskId: "task-source",
    targetTaskId: "task-target",
    modifiedFiles: [],
    workspaceRoot: "/workspace",
    model: "claude-opus-4-20250514",
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

describe("reconciliateEdgeDefinition", () => {
  it("supports() is true for a provider that maps to the host-routed backend", () => {
    expect(reconciliateEdgeDefinition.supports?.(input())).toBe(true);
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
    expect(reconciliateEdgeDefinition.supports?.(withUnmapped)).toBe(false);
  });

  it("recipe() routes to the host-routed backend with the read/write/list/search tool set", () => {
    const recipe = reconciliateEdgeDefinition.recipe!(input());
    expect(recipe.integration).toBe("host");
    expect(recipe.host_tools?.map((t) => t.name).sort()).toEqual(["list_files", "read_file", "search_codebase", "write_file"]);
    expect(recipe.execution_params).toEqual({ model: "claude-opus-4-20250514", max_tokens: 128_000, reasoning_effort: undefined });
    expect(recipe.system_prompt).toContain("code reconciliation assistant");
    expect(recipe.system_prompt).toContain("Workspace root: /workspace");
  });

  it("recipe() lists modified files, source/target instructions, and the user message in the system prompt", () => {
    const recipe = reconciliateEdgeDefinition.recipe!(
      input({
        modifiedFiles: ["src/a.ts", "src/b.ts"],
        sourcePrompt: "Add the schema.",
        targetPrompt: "Add the API route.",
        userMessage: "Does this break the route?",
      }),
    );
    expect(recipe.system_prompt).toContain("Files modified by source task: src/a.ts, src/b.ts");
    expect(recipe.system_prompt).toContain("Source task instructions: Add the schema.");
    expect(recipe.system_prompt).toContain("Target task instructions: Add the API route.");
    expect(recipe.system_prompt).toContain("User message: Does this break the route?");
  });

  it("recipe() falls back to defaults when modifiedFiles/sourcePrompt/targetPrompt/userMessage are absent", () => {
    const recipe = reconciliateEdgeDefinition.recipe!(input());
    expect(recipe.system_prompt).toContain("No files were modified by the source task.");
    expect(recipe.system_prompt).toContain("Source task instructions: (not provided)");
    expect(recipe.system_prompt).toContain("Target task instructions: (not provided)");
    expect(recipe.system_prompt).toContain("User message: Check for code conflicts between the tasks and reconcile if needed.");
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
    expect(() => reconciliateEdgeDefinition.recipe!(withUnmapped)).toThrow(/cannot run on core/);
  });

  it("promptText() defaults to the sidecar's own fallback message when userMessage is absent", () => {
    expect(reconciliateEdgeDefinition.promptText!(input())).toBe("Check for code conflicts between the tasks and reconcile if needed.");
  });

  it("promptText() flattens prior chat history ahead of the user message", () => {
    const text = reconciliateEdgeDefinition.promptText!(
      input({ userMessage: "Fix it.", chatHistory: [{ role: "user", content: "Earlier question." }] }),
    );
    expect(text).toBe("User: Earlier question.\n\nFix it.");
  });

  it("hostTools() wires read_file/write_file/list_files/search_codebase using the run's workspaceRoot and host", () => {
    const anInput = input({ workspaceRoot: "/ws" });
    const tools = reconciliateEdgeDefinition.hostTools?.(anInput, fakeHost, { scratch: {} }, () => {});
    expect(Object.keys(tools ?? {}).sort()).toEqual(["list_files", "read_file", "search_codebase", "write_file"]);
    expect(exploreTools.readTool).toHaveBeenCalledWith("/ws", fakeHost);
    expect(exploreTools.listFilesTool).toHaveBeenCalledWith("/ws");
    expect(exploreTools.searchCodebaseTool).toHaveBeenCalledWith("/ws");
    expect(exploreTools.writeTool).toHaveBeenCalledWith("/ws", fakeHost, expect.any(Set));
  });

  it("toResult() reads the transcript's last message", () => {
    const result = reconciliateEdgeDefinition.toResult?.(transcriptWith("No conflicts found."), input(), { scratch: {} });
    expect(result).toEqual({ response: "No conflicts found." });
  });

  it("toResult() falls back to a default response when the transcript is empty", () => {
    const result = reconciliateEdgeDefinition.toResult?.(createTranscript(), input(), { scratch: {} });
    expect(result).toEqual({ response: "Reconciliation completed." });
  });

  it("usageContext() carries the run's workspaceRoot and model", () => {
    expect(reconciliateEdgeDefinition.usageContext(input())).toEqual({ workspaceRoot: "/workspace", model: "claude-opus-4-20250514" });
  });
});
