// ============================================================
// definitions/wiki_page.ts — wiki_page on rusty-core: one documentation page,
// written in a single model turn with no tools. The host built the brief
// (outline, facts, numbered sources) and checks the answer afterwards, so
// this capability only carries the text through the chat model routing.
// ============================================================

import type { CustomProvider } from "../../../store/types";
import type { CapabilityResult, WikiPageInput } from "../../contract";
import type { CoreCapabilityDefinition } from "../CoreHarness";
import { CORE_MAX_TOKENS, mapProviderToIntegration } from "../providerMapping";
import type { SessionRecipe } from "../SessionRecipe";
import type { Transcript } from "../transcript";

/** Some models wrap the page in a code fence; the page itself is Markdown. */
export function unwrapMarkdown(text: string): string {
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```(?:markdown|md)?\s*\n([\s\S]*?)\n```$/i);
  return (fenced ? fenced[1] : trimmed).trim();
}

export const wikiPageDefinition: CoreCapabilityDefinition<"wiki_page"> = {
  capability: "wiki_page",

  supports: (input) => mapProviderToIntegration(input.customProvider as CustomProvider, input.model).supported,

  recipe: (input: WikiPageInput): SessionRecipe => {
    const mapped = mapProviderToIntegration(input.customProvider as CustomProvider, input.model);
    if (!mapped.supported) {
      throw new Error(`CoreHarness: wiki_page cannot run on core -- ${mapped.reason}`);
    }
    return {
      workspace: { root: input.workspaceRoot, binding: "host" },
      integration: mapped.integration,
      integration_config: mapped.integration_config,
      execution_params: { model: mapped.model ?? input.model, max_tokens: CORE_MAX_TOKENS, reasoning_effort: mapped.reasoningEffort },
      system_prompt: input.system,
    };
  },

  promptText: (input) => input.prompt,

  toResult: (transcript: Transcript): CapabilityResult<"wiki_page"> => {
    const markdown = unwrapMarkdown(transcript.lastMessageText());
    if (!markdown) throw new Error("The model returned an empty page.");
    return { markdown };
  },

  usageContext: (input) => ({ workspaceRoot: input.workspaceRoot, model: input.model }),
};
