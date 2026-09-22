// ============================================================
// definitions/inline_chat.ts — inline_chat on rusty-core
// (HARNESS_CONTRACT_PLAN.md Milestone B4/B5's first capability): no tools,
// no MCP, no skills -- the smallest capability, the same reason
// testing/contractTests.ts is fixed on it.
//
// The system prompt is copied verbatim from agent-sidecar/src/services/
// inlineChatPi.ts's runInlineChatWithModel (its systemPrompt template
// literal) so a core run answers the exact same question the sidecar's
// inline chat does -- only the transport changes, not the prompt
// (HARNESS_CONTRACT_PLAN.md's own risk table: "Prompt-behavior regression
// on core ... keep prompts verbatim from the sidecar files cited above").
// ============================================================

import type { CustomProvider } from "../../../store/types";
import type { CapabilityResult, InlineChatInput } from "../../contract";
import type { CoreCapabilityDefinition } from "../CoreHarness";
import { mapProviderToIntegration } from "../providerMapping";
import type { SessionRecipe } from "../SessionRecipe";
import type { Transcript } from "../transcript";

function systemPrompt(input: InlineChatInput): string {
  const selected = input.context.selection;
  const selectedContext = selected.text
    ? `Selected code (lines ${selected.startLine}-${selected.endLine}):\n\`\`\`${input.context.language}\n${selected.text}\n\`\`\``
    : `Cursor is at line ${selected.startLine}, column ${selected.startColumn}.`;

  return `You are Rusty Inline Chat, a concise coding assistant embedded directly in a code editor.

Current file: ${input.context.filePath}
Language: ${input.context.language}
${selectedContext}

Current file contents:
\`\`\`${input.context.language}
${input.context.fileContent.slice(0, 120_000)}
\`\`\`

Answer only the user's focused question about this editor context. Prefer a short explanation followed by a small code example when useful. Do not use tools, delegate work, inspect unrelated files, or claim that files were changed. If the user asks for a change, provide the exact replacement code for the selected region (or the smallest relevant snippet when there is no selection).`;
}

/**
 * rusty-core has no conversation-history seeding yet (upstream ask U2) --
 * flattened into the prompt text itself, ahead of the current message.
 */
function flattenHistory(history: InlineChatInput["history"]): string {
  if (history.length === 0) return "";
  const lines = history.map((turn) => `${turn.role === "user" ? "User" : "Assistant"}: ${turn.content}`);
  return `${lines.join("\n\n")}\n\n`;
}

export const inlineChatDefinition: CoreCapabilityDefinition<"inline_chat"> = {
  capability: "inline_chat",

  supports: (input) => mapProviderToIntegration(input.customProvider as CustomProvider, input.model).supported,

  recipe: (input): SessionRecipe => {
    const mapped = mapProviderToIntegration(input.customProvider as CustomProvider, input.model);
    if (!mapped.supported) {
      throw new Error(`CoreHarness: inline_chat cannot run on core -- ${mapped.reason}`);
    }
    return {
      workspace: { root: input.workspaceRoot, binding: "host" },
      integration: mapped.integration,
      integration_config: mapped.integration_config,
      // `model` carries the UI's own reference (e.g.
      // "opencode/big-pickle") through unresolved -- the host-routed
      // backend's answerer resolves it against the real provider (Phase 1:
      // the sidecar's own resolveProviderModelSelection, the same
      // resolution every other sidecar-routed capability already uses),
      // not rusty-core or this file.
      execution_params: { model: mapped.model ?? input.model, max_tokens: 4096, reasoning_effort: mapped.reasoningEffort },
      system_prompt: systemPrompt(input),
    };
  },

  promptText: (input) => `${flattenHistory(input.history)}${input.message}`,

  toResult: (transcript: Transcript, _input): CapabilityResult<"inline_chat"> => ({
    response: transcript.lastMessageText(),
  }),

  usageContext: (input) => ({ workspaceRoot: input.workspaceRoot, model: input.model }),
};
