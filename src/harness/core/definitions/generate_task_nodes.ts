// ============================================================
// definitions/generate_task_nodes.ts — generate_task_nodes on rusty-core
// (HARNESS_CONTRACT_PLAN.md Milestone C): no tools, so -- like
// generate_skill -- needs nothing from rusty-core upstream, confirming the
// Milestone C table's own prediction.
//
// The one real shape difference from every capability so far: the sidecar's
// own generateTaskNodes.ts retries once, with a stricter instruction, when
// the model's JSON comes back empty or unparseable -- this is the first
// capability to use CoreCapabilityDefinition's `onCompleted` hook instead
// of a single-shot `toResult`. The sidecar's own retry also swaps the
// *system* prompt on the second attempt; rusty-core has no way to change a
// session's system prompt mid-session yet (upstream ask U3's
// `MutationCommand::ConfigureExecution` isn't there), so the retry
// instruction is folded into the retry's own prompt text instead -- the
// model still sees the same task-extraction system prompt throughout, plus
// a new user turn asking it to fix its last answer. Documented deviation,
// not a silent one.
// ============================================================

import type { CustomProvider } from "../../../store/types";
import type { CapabilityResult, GenerateTaskNodesInput } from "../../contract";
import type { CoreCapabilityDefinition } from "../CoreHarness";
import { mapProviderToIntegration } from "../providerMapping";
import type { SessionRecipe } from "../SessionRecipe";
import type { Transcript } from "../transcript";
import { InvalidTaskOutputError, parseGeneratedTaskGraph } from "./generatedTaskGraph";
import { buildTaskGenerationQuery, TASK_GENERATION_SYSTEM_PROMPT, type TaskGenerationChatEntry } from "./taskGenerationPrompt";

/** Matches generateTaskNodes.ts's own `for (attempt = 1; attempt <= 2; ...)`. */
const MAX_ATTEMPTS = 2;

const RETRY_EMPTY_INSTRUCTION =
  "Your previous response contained no visible text. This is the final retry. Use minimal reasoning and return the required JSON object immediately.";
const RETRY_INVALID_INSTRUCTION =
  "Your previous response could not be parsed as the required task JSON. This is the final retry. Return exactly one JSON object that follows the schema, with no surrounding text.";

function validHistory(chatHistory: unknown): TaskGenerationChatEntry[] {
  return Array.isArray(chatHistory)
    ? chatHistory.filter(
        (entry): entry is TaskGenerationChatEntry =>
          !!entry &&
          typeof entry === "object" &&
          ((entry as { role?: unknown }).role === "user" || (entry as { role?: unknown }).role === "assistant") &&
          typeof (entry as { content?: unknown }).content === "string",
      )
    : [];
}

export const generateTaskNodesDefinition: CoreCapabilityDefinition<"generate_task_nodes"> = {
  capability: "generate_task_nodes",

  supports: (input) => mapProviderToIntegration(input.customProvider as CustomProvider, input.model).supported,

  recipe: (input: GenerateTaskNodesInput): SessionRecipe => {
    const mapped = mapProviderToIntegration(input.customProvider as CustomProvider, input.model);
    if (!mapped.supported) {
      throw new Error(`CoreHarness: generate_task_nodes cannot run on core -- ${mapped.reason}`);
    }
    if (validHistory(input.chatHistory).length === 0) {
      throw new Error("Discuss the story in Global Chat before generating tasks.");
    }
    return {
      workspace: { root: input.workspaceRoot, binding: "host" },
      integration: mapped.integration,
      integration_config: mapped.integration_config,
      // Fixed "minimal" reasoning regardless of the model reference's own
      // suffix -- generateTaskNodes.ts passes `reasoning: "minimal"`
      // unconditionally, not `options.reasoning || runtime.reasoningEffort`
      // the way the sidecar's generic completeText path does. rusty-core
      // has no "minimal" level; clamped to its lowest ("low"), the same
      // clamp providerMapping.ts uses for a model-reference-derived effort.
      execution_params: { model: mapped.model ?? input.model, max_tokens: 16_000, reasoning_effort: "low" },
      system_prompt: TASK_GENERATION_SYSTEM_PROMPT,
    };
  },

  promptText: (input: GenerateTaskNodesInput) =>
    buildTaskGenerationQuery(validHistory(input.chatHistory), input.additionalInstructions ?? ""),

  onCompleted: (transcript: Transcript, _input: GenerateTaskNodesInput, attempt: number) => {
    const content = transcript.lastMessageText();
    if (!content.trim()) {
      if (attempt < MAX_ATTEMPTS) return { done: false, promptText: RETRY_EMPTY_INSTRUCTION };
      throw new Error(
        "The model returned no task JSON after two attempts. Try again or verify that the provider supports text completions for this model.",
      );
    }
    try {
      const graph = parseGeneratedTaskGraph(content);
      const result: CapabilityResult<"generate_task_nodes"> = { tasks: graph.tasks, contexts: graph.contexts, attempts: attempt };
      return { done: true, result };
    } catch (error) {
      if (!(error instanceof InvalidTaskOutputError)) throw error;
      if (attempt < MAX_ATTEMPTS) return { done: false, promptText: RETRY_INVALID_INSTRUCTION };
      throw new Error(
        "The model returned invalid task JSON twice. This model may be too small to generate a reliable task plan. Switch to a more capable model and try again.",
      );
    }
  },

  usageContext: (input) => ({ workspaceRoot: input.workspaceRoot, model: input.model }),
};
