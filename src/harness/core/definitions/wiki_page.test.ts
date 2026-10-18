import { describe, expect, it } from "vitest";

import type { WikiPageInput } from "../../contract";
import { createTranscript } from "../transcript";
import { unwrapMarkdown, wikiPageDefinition } from "./wiki_page";

function input(overrides: Partial<WikiPageInput> = {}): WikiPageInput {
  return {
    model: "claude-opus-4-20250514",
    customProvider: { id: "p1", name: "Anthropic", baseUrl: "https://api.anthropic.com", apiKey: "sk-test", apiType: "anthropic-messages", models: [] },
    workspaceRoot: "/ws",
    system: "Write the page.",
    prompt: "## Sources\n[1] a.rs",
    ...overrides,
  };
}

function transcriptWith(text: string) {
  const transcript = createTranscript();
  transcript.push("m1", text);
  return transcript;
}

describe("wikiPageDefinition", () => {
  it("runs with no tools, the brief's system text and the brief as the only prompt", () => {
    const recipe = wikiPageDefinition.recipe!(input());
    expect(recipe.system_prompt).toBe("Write the page.");
    expect(recipe.workspace).toEqual({ root: "/ws", binding: "host" });
    expect(wikiPageDefinition.promptText!(input())).toBe("## Sources\n[1] a.rs");
    expect(wikiPageDefinition.usageContext(input())).toEqual({ workspaceRoot: "/ws", model: "claude-opus-4-20250514" });
  });

  it("returns the page without a surrounding code fence", () => {
    expect(wikiPageDefinition.toResult(transcriptWith("```markdown\n## A\nText [1].\n```"), input())).toEqual({ markdown: "## A\nText [1]." });
    expect(unwrapMarkdown("## A\n```rust\nfn x() {}\n```")).toBe("## A\n```rust\nfn x() {}\n```");
  });

  it("refuses an empty answer", () => {
    expect(() => wikiPageDefinition.toResult(transcriptWith("  "), input())).toThrow(/empty page/);
  });
});
