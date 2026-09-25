// ============================================================
// definitions/generate_skill.ts — generate_skill on rusty-core
// (HARNESS_CONTRACT_PLAN.md Milestone C's first capability): no tools, no
// MCP, JSON output parsed from the model's own text -- the plan's own table
// lists this as needing zero rusty-core upstream changes, making it the
// natural first capability past inline_chat to prove the
// CoreCapabilityDefinition pattern generalizes.
//
// The meta-prompt, the JSON-extraction/fallback logic, and the tool
// allow-list are copied verbatim from agent-sidecar/src/capabilities/
// generateSkill.ts's own generateSkill() so a core run produces the exact
// same spec shape the sidecar's own capability does -- only the transport
// changes, not the behavior (HARNESS_CONTRACT_PLAN.md's own risk table).
// ============================================================

import type { CustomProvider } from "../../../store/types";
import type { CapabilityResult, GenerateSkillInput } from "../../contract";
import type { CoreCapabilityDefinition } from "../CoreHarness";
import { CORE_MAX_TOKENS, mapProviderToIntegration } from "../providerMapping";
import type { SessionRecipe } from "../SessionRecipe";
import type { Transcript } from "../transcript";
import { SKILL_TOOLS } from "../../../config/skillTools";

const AVAILABLE_TOOLS = SKILL_TOOLS.map((tool) => tool.id);

function metaPrompt(description: string): string {
  return `You are a skill designer for an AI coding agent. Based on the following description, generate a skill specification as a JSON object.

Description: ${description}

Return ONLY a valid JSON object with this structure (no markdown, no explanation):
{
  "systemPrompt": "The system prompt for the skill - be specific about behavior, guidelines, and tone",
  "enabledTools": ["read_file", "write_file", "list_files", "search_codebase", "web_search", "run_command"] - choose the tools this skill should have access to,
  "description": "A brief 1-2 sentence description of what this skill does"
}

Available tools:
- read_file: Read any file in the workspace
- write_file: Write or edit a file
- list_files: List all files in the workspace
- search_codebase: Search for text patterns across the codebase
- web_search: Search the public web for current information and cited sources
- run_command: Run an explicitly user-approved non-interactive command in the physical workspace

Enable only tools required by the user's description. Do not add web or command access unless needed.
For a read-only analysis/planning skill, only enable: read_file, list_files, search_codebase
An empty enabledTools array is valid for a skill that only answers questions.`;
}

/**
 * Parses the model's raw response text into a skill spec, matching
 * generateSkill.ts's own extraction/fallback/tool-filtering exactly:
 * tolerate prose around the JSON object, fall back to a generic
 * systemPrompt/enabledTools when the model's own JSON is missing either,
 * without widening an empty or missing tool allowlist.
 */
function parseSkillSpec(content: string, description: string): Record<string, unknown> {
  let spec: Record<string, unknown>;
  try {
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    spec = JSON.parse(jsonMatch ? jsonMatch[0] : content);
  } catch {
    throw new Error("Failed to parse skill specification. Please try again.");
  }

  if (!spec || typeof spec !== "object" || Array.isArray(spec)) throw new Error("Invalid skill specification");
  spec.systemPrompt = spec.systemPrompt || `You are a coding agent focused on: ${description}`;
  if (spec.enabledTools === undefined) spec.enabledTools = [];
  if (!Array.isArray(spec.enabledTools)) throw new Error("Skill enabledTools must be a list");
  spec.enabledTools = (spec.enabledTools as string[]).filter((tool) => AVAILABLE_TOOLS.includes(tool));
  return spec;
}

export const generateSkillDefinition: CoreCapabilityDefinition<"generate_skill"> = {
  capability: "generate_skill",

  supports: (input) => mapProviderToIntegration(input.customProvider as CustomProvider, input.model).supported,

  recipe: (input: GenerateSkillInput): SessionRecipe => {
    const mapped = mapProviderToIntegration(input.customProvider as CustomProvider, input.model);
    if (!mapped.supported) {
      throw new Error(`CoreHarness: generate_skill cannot run on core -- ${mapped.reason}`);
    }
    return {
      // No tools, so nothing ever reads/writes through it -- a root is
      // still required by SessionBuilder regardless (workspace.root is
      // non-optional on the wire), so an absent input.workspaceRoot (it's
      // optional on this capability alone, unlike every other one) falls
      // back to "" rather than failing to build a recipe at all.
      workspace: { root: input.workspaceRoot ?? "", binding: "host" },
      integration: mapped.integration,
      integration_config: mapped.integration_config,
      execution_params: { model: mapped.model ?? input.model, max_tokens: CORE_MAX_TOKENS, reasoning_effort: mapped.reasoningEffort },
      system_prompt: metaPrompt(input.description),
    };
  },

  promptText: (input) => `Generate a skill for: ${input.description}`,

  toResult: (transcript: Transcript, input: GenerateSkillInput): CapabilityResult<"generate_skill"> => ({
    spec: parseSkillSpec(transcript.lastMessageText(), input.description),
  }),

  usageContext: (input) => ({ workspaceRoot: input.workspaceRoot ?? "", model: input.model }),
};
