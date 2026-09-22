import { describe, expect, it } from "vitest";

import type { GenerateSkillInput } from "../../contract";
import { createTranscript } from "../transcript";
import { generateSkillDefinition } from "./generate_skill";

function input(overrides: Partial<GenerateSkillInput> = {}): GenerateSkillInput {
  return {
    description: "A skill that reviews pull requests for style issues.",
    model: "claude-opus-4-20250514",
    customProvider: {
      id: "p1",
      name: "Anthropic",
      baseUrl: "https://api.anthropic.com",
      apiKey: "sk-test",
      apiType: "anthropic-messages",
      models: [],
    },
    workspaceRoot: "/workspace",
    ...overrides,
  };
}

function transcriptWith(text: string) {
  const transcript = createTranscript();
  transcript.push("m1", text);
  return transcript;
}

describe("generateSkillDefinition", () => {
  it.each([
    ["openrouter", "deepseek/deepseek-v4-flash"],
    ["opencode", "minimax-m3"],
  ])("routes %s through the shared tool-aware backend", (providerId, remoteId) => {
    const recipe = generateSkillDefinition.recipe!(input({
      model: `${providerId}/${remoteId}`,
      customProvider: {
        id: providerId, name: providerId, apiKey: "test-key",
        apiType: "openai-completions", models: [],
      },
    }));
    expect(recipe.integration).toBe("openai-compatible");
    expect(recipe.execution_params?.model).toBe(remoteId);
  });

  it("supports() is true for a provider that maps to the host-routed backend", () => {
    expect(generateSkillDefinition.supports?.(input())).toBe(true);
  });

  it("supports() is false for a managed transport", () => {
    const withManagedTransport = input({
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
    expect(generateSkillDefinition.supports?.(withManagedTransport)).toBe(false);
  });

  it("recipe() builds a host-bound workspace routed to the host-routed backend", () => {
    const recipe = generateSkillDefinition.recipe!(input());
    expect(recipe.workspace).toEqual({ root: "/workspace", binding: "host" });
    expect(recipe.integration).toBe("host");
    expect(recipe.integration_config).toEqual({});
    expect(recipe.execution_params).toEqual({ model: "claude-opus-4-20250514", max_tokens: 128_000, reasoning_effort: undefined });
  });

  it("recipe() defaults an absent workspaceRoot to an empty string rather than throwing", () => {
    const recipe = generateSkillDefinition.recipe!(input({ workspaceRoot: undefined }));
    expect(recipe.workspace.root).toBe("");
  });

  it("recipe() embeds the description in the meta-prompt", () => {
    const recipe = generateSkillDefinition.recipe!(input());
    expect(recipe.system_prompt).toContain("A skill that reviews pull requests for style issues.");
    expect(recipe.system_prompt).toContain('"systemPrompt"');
    expect(recipe.system_prompt).toContain('"enabledTools"');
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
    expect(() => generateSkillDefinition.recipe!(withUnmapped)).toThrow(/cannot run on core/);
  });

  it("promptText() asks for a skill for the given description", () => {
    expect(generateSkillDefinition.promptText!(input())).toBe(
      "Generate a skill for: A skill that reviews pull requests for style issues.",
    );
  });

  it("toResult() parses a well-formed JSON response", () => {
    const spec = { systemPrompt: "Review PRs for style.", enabledTools: ["read_file", "search_codebase"], description: "Style reviewer." };
    const result = generateSkillDefinition.toResult!(transcriptWith(JSON.stringify(spec)), input(), { scratch: {} });
    expect(result).toEqual({ spec });
  });

  it("toResult() extracts JSON embedded in surrounding prose", () => {
    const spec = { systemPrompt: "Review PRs.", enabledTools: ["read_file"], description: "d" };
    const withProse = `Here you go:\n${JSON.stringify(spec)}\nHope that helps!`;
    const result = generateSkillDefinition.toResult!(transcriptWith(withProse), input(), { scratch: {} });
    expect(result).toEqual({ spec });
  });

  it("toResult() fills in a fallback systemPrompt/enabledTools when the model's JSON omits them", () => {
    const result = generateSkillDefinition.toResult!(transcriptWith(JSON.stringify({ description: "d" })), input(), { scratch: {} });
    expect(result).toEqual({
      spec: {
        description: "d",
        systemPrompt: "You are a coding agent focused on: A skill that reviews pull requests for style issues.",
        enabledTools: ["read_file", "list_files", "search_codebase"],
      },
    });
  });

  it("toResult() filters enabledTools down to the known tool allow-list", () => {
    const spec = { systemPrompt: "s", enabledTools: ["read_file", "delete_everything", "search_codebase"] };
    const result = generateSkillDefinition.toResult!(transcriptWith(JSON.stringify(spec)), input(), { scratch: {} });
    expect((result as { spec: { enabledTools: string[] } }).spec.enabledTools).toEqual(["read_file", "search_codebase"]);
  });

  it("toResult() falls back to the default tool set when every requested tool is filtered out", () => {
    const spec = { systemPrompt: "s", enabledTools: ["not_a_real_tool"] };
    const result = generateSkillDefinition.toResult!(transcriptWith(JSON.stringify(spec)), input(), { scratch: {} });
    expect((result as { spec: { enabledTools: string[] } }).spec.enabledTools).toEqual(["read_file", "list_files", "search_codebase"]);
  });

  it("toResult() throws a clear error when the model's response isn't valid JSON at all", () => {
    expect(() => generateSkillDefinition.toResult!(transcriptWith("not json at all"), input(), { scratch: {} })).toThrow(
      /Failed to parse skill specification/,
    );
  });

  it("usageContext() carries the run's workspaceRoot and model, defaulting an absent workspaceRoot to \"\"", () => {
    expect(generateSkillDefinition.usageContext(input({ workspaceRoot: undefined }))).toEqual({
      workspaceRoot: "",
      model: "claude-opus-4-20250514",
    });
  });
});
