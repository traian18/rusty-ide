import { describe, expect, it } from "vitest";

import type { InlineChatInput } from "../../contract";
import { createTranscript } from "../transcript";
import { inlineChatDefinition } from "./inline_chat";

function input(overrides: Partial<InlineChatInput> = {}): InlineChatInput {
  return {
    sessionId: "editor-1",
    message: "What does this function do?",
    model: "claude-opus-4-20250514",
    workspaceRoot: "/workspace",
    customProvider: {
      id: "p1",
      name: "Anthropic",
      baseUrl: "https://api.anthropic.com",
      apiKey: "sk-test",
      apiType: "anthropic-messages",
      models: [],
    },
    history: [],
    context: {
      filePath: "/workspace/src/index.ts",
      language: "typescript",
      fileContent: "export function add(a: number, b: number) { return a + b; }",
      selection: { text: "", startLine: 1, startColumn: 1, endLine: 1, endColumn: 1 },
    },
    ...overrides,
  };
}

describe("inlineChatDefinition", () => {
  it("supports() is true for a provider that maps to a core integration", () => {
    expect(inlineChatDefinition.supports?.(input())).toBe(true);
  });

  it("supports() is now true for apiTypes host-routing newly covers (e.g. google-generative-ai)", () => {
    const withGemini = input({
      customProvider: {
        id: "p1",
        name: "Gemini",
        baseUrl: "https://generativelanguage.googleapis.com",
        apiKey: "sk-test",
        apiType: "google-generative-ai",
        models: [],
      },
    });
    expect(inlineChatDefinition.supports?.(withGemini)).toBe(true);
  });

  it("supports() is false for a managed transport", () => {
    const withManagedTransport = input({
      customProvider: {
        id: "p1",
        name: "Copilot",
        baseUrl: "",
        apiKey: "",
        apiType: "openai-completions",
        transport: "some-future-sdk" as any, // codex/claude-code/copilot are now core-supported (Phase 3); this simulates a transport core does not recognize yet
        models: [],
      },
    });
    expect(inlineChatDefinition.supports?.(withManagedTransport)).toBe(false);
  });

  it("recipe() builds a host-bound workspace and routes to the host-routed backend with an empty integration_config", () => {
    const recipe = inlineChatDefinition.recipe!(input());
    expect(recipe.workspace).toEqual({ root: "/workspace", binding: "host" });
    expect(recipe.integration).toBe("host");
    expect(recipe.integration_config).toEqual({});
  });

  it("recipe() carries the raw model reference and max_tokens 4096 into execution_params", () => {
    const recipe = inlineChatDefinition.recipe!(input());
    expect(recipe.execution_params).toEqual({ model: "claude-opus-4-20250514", max_tokens: 4096, reasoning_effort: undefined });
  });

  it("recipe() carries the UI's model reference through unresolved for a provider with no explicit modelRouting.ts route -- the answerer resolves it, not this file", () => {
    const withReference = input({
      customProvider: {
        id: "some-http-gateway",
        name: "Some Gateway",
        baseUrl: "https://gateway.example/v1",
        apiKey: "sk-test",
        apiType: "openai-completions",
        models: [],
      },
      model: "some-http-gateway/big-pickle",
    });
    const recipe = inlineChatDefinition.recipe!(withReference);
    expect(recipe.integration).toBe("host");
    expect(recipe.execution_params?.model).toBe("some-http-gateway/big-pickle");
  });

  it("recipe() carries a reasoning-effort suffix into execution_params.reasoning_effort, clamped to core's three levels", () => {
    const withReasoningSuffix = input({
      customProvider: {
        id: "some-http-gateway",
        name: "Some Gateway",
        baseUrl: "https://gateway.example/v1",
        apiKey: "sk-test",
        apiType: "openai-completions",
        models: [],
      },
      model: "some-http-gateway/big-pickle::reasoning=minimal",
    });
    const recipe = inlineChatDefinition.recipe!(withReasoningSuffix);
    expect(recipe.execution_params).toEqual({
      model: "some-http-gateway/big-pickle::reasoning=minimal",
      max_tokens: 4096,
      reasoning_effort: "low",
    });
  });

  it("recipe() resolves the model id for a modelRouting.ts-routed provider (OpenCode Zen) instead of sending the raw prefixed/suffixed reference", () => {
    // Regression test for a real bug: the anthropic/openai-responses/openai-compatible
    // clients all prefer `ModelRequest.model` (from `execution_params.model`) over
    // `integration_config`'s own `default_model`/`model` -- so leaving the raw UI
    // reference in `execution_params.model` silently defeated modelRouting.ts's own
    // resolution and sent e.g. "opencode/claude-haiku-4-5::reasoning=minimal" as the
    // literal model name to OpenCode Zen, which rejected it with a 401.
    const withOpenCodeRoute = input({
      customProvider: {
        id: "opencode",
        name: "OpenCode Zen",
        baseUrl: "https://opencode.ai/zen/v1",
        apiKey: "sk-zen-test",
        apiType: "openai-completions",
        models: [],
      },
      model: "opencode/claude-haiku-4-5::reasoning=minimal",
    });
    const recipe = inlineChatDefinition.recipe!(withOpenCodeRoute);
    expect(recipe.integration).toBe("anthropic");
    expect(recipe.execution_params?.model).toBe("claude-haiku-4-5");
    expect((recipe.integration_config as Record<string, unknown>).default_model).toBe("claude-haiku-4-5");
  });

  it("recipe() embeds the file path, language, and file contents in the system prompt", () => {
    const recipe = inlineChatDefinition.recipe!(input());
    expect(recipe.system_prompt).toContain("/workspace/src/index.ts");
    expect(recipe.system_prompt).toContain("typescript");
    expect(recipe.system_prompt).toContain("export function add");
  });

  it("recipe() describes the cursor position when there is no selection", () => {
    const recipe = inlineChatDefinition.recipe!(input());
    expect(recipe.system_prompt).toContain("Cursor is at line 1, column 1.");
  });

  it("recipe() quotes the selected text when there is a selection", () => {
    const withSelection = input({
      context: {
        filePath: "/workspace/src/index.ts",
        language: "typescript",
        fileContent: "export function add(a: number, b: number) { return a + b; }",
        selection: { text: "a + b", startLine: 1, startColumn: 40, endLine: 1, endColumn: 45 },
      },
    });
    const recipe = inlineChatDefinition.recipe!(withSelection);
    expect(recipe.system_prompt).toContain("Selected code (lines 1-1)");
    expect(recipe.system_prompt).toContain("a + b");
  });

  it("recipe() throws for an unsupported provider rather than building a broken recipe", () => {
    const withUnmapped = input({
      customProvider: {
        id: "p1",
        name: "Copilot",
        baseUrl: "",
        apiKey: "",
        apiType: "openai-completions",
        transport: "some-future-sdk" as any, // codex/claude-code/copilot are now core-supported (Phase 3); this simulates a transport core does not recognize yet
        models: [],
      },
    });
    expect(() => inlineChatDefinition.recipe!(withUnmapped)).toThrow(/cannot run on core/);
  });

  it("promptText() is just the message when there is no history", () => {
    expect(inlineChatDefinition.promptText!(input())).toBe("What does this function do?");
  });

  it("promptText() flattens history ahead of the message, since core has no history seeding", () => {
    const withHistory = input({
      history: [
        { role: "user", content: "What language is this?" },
        { role: "assistant", content: "TypeScript." },
      ],
    });
    expect(inlineChatDefinition.promptText!(withHistory)).toBe(
      "User: What language is this?\n\nAssistant: TypeScript.\n\nWhat does this function do?",
    );
  });

  it("toResult() reads the transcript's last accumulated message", () => {
    const transcript = createTranscript();
    transcript.push("m1", "It adds ");
    transcript.push("m1", "two numbers.");
    expect(inlineChatDefinition.toResult!(transcript, input(), { scratch: {} })).toEqual({ response: "It adds two numbers." });
  });

  it("usageContext() carries the run's workspaceRoot and model", () => {
    expect(inlineChatDefinition.usageContext(input())).toEqual({
      workspaceRoot: "/workspace",
      model: "claude-opus-4-20250514",
    });
  });
});
