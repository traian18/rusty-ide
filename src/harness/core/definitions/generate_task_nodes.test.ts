import { describe, expect, it } from "vitest";

import type { GenerateTaskNodesInput } from "../../contract";
import { createTranscript } from "../transcript";
import { generateTaskNodesDefinition } from "./generate_task_nodes";

function input(overrides: Partial<GenerateTaskNodesInput> = {}): GenerateTaskNodesInput {
  return {
    requestId: "req-1",
    nodeId: "node-1",
    model: "claude-opus-4-20250514",
    customProvider: {
      id: "p1",
      name: "Anthropic",
      baseUrl: "https://api.anthropic.com",
      apiKey: "sk-test",
      apiType: "anthropic-messages",
      models: [],
    },
    chatHistory: [
      { role: "user", content: "Let's plan a login form." },
      { role: "assistant", content: "Sure, here's a plan..." },
    ],
    workspaceRoot: "/workspace",
    ...overrides,
  };
}

function transcriptWith(text: string) {
  const transcript = createTranscript();
  transcript.push("m1", text);
  return transcript;
}

const VALID_GRAPH = JSON.stringify({
  tasks: [{ key: "task-1", title: "Build the form", description: "Add the login form component.", dependsOn: [] }],
  contexts: [],
});

describe("generateTaskNodesDefinition", () => {
  it("supports() is true for a provider that maps to the host-routed backend", () => {
    expect(generateTaskNodesDefinition.supports?.(input())).toBe(true);
  });

  it("recipe() routes to the host-routed backend with a fixed low reasoning effort and a realistic max_tokens ceiling", () => {
    const recipe = generateTaskNodesDefinition.recipe!(input());
    expect(recipe.integration).toBe("host");
    expect(recipe.execution_params).toEqual({ model: "claude-opus-4-20250514", max_tokens: 64_000, reasoning_effort: "low" });
    expect(recipe.system_prompt).toContain("extract an implementation graph");
  });

  it("recipe() ignores a reasoning-effort suffix on the model reference -- this capability always forces low", () => {
    const recipe = generateTaskNodesDefinition.recipe!(input({ model: "claude-opus-4-20250514::reasoning=high" }));
    expect(recipe.execution_params?.reasoning_effort).toBe("low");
  });

  it("recipe() throws when there's no chat history to discuss", () => {
    expect(() => generateTaskNodesDefinition.recipe!(input({ chatHistory: [] }))).toThrow(/Discuss the story/);
  });

  it("recipe() throws when chatHistory contains only non-user/assistant entries", () => {
    expect(() => generateTaskNodesDefinition.recipe!(input({ chatHistory: [{ role: "system", content: "x" }] }))).toThrow(
      /Discuss the story/,
    );
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
    expect(() => generateTaskNodesDefinition.recipe!(withUnmapped)).toThrow(/cannot run on core/);
  });

  it("promptText() folds the filtered chat history and additional instructions into the query", () => {
    const text = generateTaskNodesDefinition.promptText!(input({ additionalInstructions: "Keep it under 5 tasks." }));
    expect(text).toContain("USER: Let's plan a login form.");
    expect(text).toContain("ASSISTANT: Sure, here's a plan...");
    expect(text).toContain("ADDITIONAL TASK-GENERATION INSTRUCTIONS:\nKeep it under 5 tasks.");
  });

  it("onCompleted() returns done:true with the parsed graph and the attempt count on a valid first response", () => {
    const outcome = generateTaskNodesDefinition.onCompleted?.(transcriptWith(VALID_GRAPH), input(), 1, { scratch: {} });
    expect(outcome).toEqual({
      done: true,
      result: {
        tasks: [{ key: "task-1", title: "Build the form", description: "Add the login form component.", dependsOn: [] }],
        contexts: [],
        attempts: 1,
      },
    });
  });

  it("onCompleted() retries once with a stricter instruction when the response is empty", () => {
    const outcome = generateTaskNodesDefinition.onCompleted?.(transcriptWith(""), input(), 1, { scratch: {} });
    expect(outcome).toEqual({ done: false, promptText: expect.stringContaining("no visible text") });
  });

  it("onCompleted() throws a clear error when the response is still empty on the final attempt", () => {
    expect(() => generateTaskNodesDefinition.onCompleted?.(transcriptWith("   "), input(), 2, { scratch: {} })).toThrow(
      /no task JSON after two attempts/,
    );
  });

  it("onCompleted() retries once with a stricter instruction when the response can't be parsed", () => {
    const outcome = generateTaskNodesDefinition.onCompleted?.(transcriptWith("not json at all"), input(), 1, { scratch: {} });
    expect(outcome).toEqual({ done: false, promptText: expect.stringContaining("could not be parsed") });
  });

  it("onCompleted() throws a clear error when the response is still invalid on the final attempt", () => {
    expect(() => generateTaskNodesDefinition.onCompleted?.(transcriptWith("still not json"), input(), 2, { scratch: {} })).toThrow(
      /invalid task JSON twice/,
    );
  });

  it("usageContext() carries the run's workspaceRoot and model", () => {
    expect(generateTaskNodesDefinition.usageContext(input())).toEqual({
      workspaceRoot: "/workspace",
      model: "claude-opus-4-20250514",
    });
  });
});
