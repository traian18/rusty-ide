import { describe, expect, it } from "vitest";
import { createChatSearchIndex, findChatSearchMatches, getChatSearchNormalizationCount, normalizeChatSearchText, resetChatSearchInstrumentation } from "./chatSearch";
import type { Message } from "./Chat";

const message = (id: string, role: Message["role"], content: string): Message => ({
  id,
  role,
  content,
  timestamp: "",
});

describe("chat search matching", () => {
  it("matches case-insensitively with literal substring semantics", () => {
    expect(findChatSearchMatches([message("a", "assistant", "Build the building")], "build")).toEqual([
      expect.objectContaining({ messageId: "a", occurrence: 0 }),
      expect.objectContaining({ messageId: "a", occurrence: 1 }),
    ]);
  });

  it("counts repeated occurrences across messages in stable order", () => {
    const matches = findChatSearchMatches([
      message("u", "user", "fix fix"),
      message("a", "assistant", "fix again"),
    ], "fix");
    expect(matches.map(({ messageId, occurrence }) => [messageId, occurrence])).toEqual([
      ["u", 0], ["u", 1], ["a", 0],
    ]);
  });

  it("normalizes whitespace and punctuation boundaries", () => {
    expect(normalizeChatSearchText("  Fix-the\nBUILD! ")).toBe("fix the build");
    expect(findChatSearchMatches([message("a", "assistant", "Fix-the build")], "fix the build")).toHaveLength(1);
  });

  it("reuses unchanged message indexes and invalidates only changed content", () => {
    const initial = [message("a", "assistant", "build one"), message("b", "user", "build two"), message("log", "console", "build")];
    resetChatSearchInstrumentation();
    const index = createChatSearchIndex(initial);
    expect(getChatSearchNormalizationCount()).toBe(2);
    findChatSearchMatches(initial, "build", index);
    expect(getChatSearchNormalizationCount()).toBe(2);

    const updated = [initial[0], message("b", "user", "changed"), initial[2]];
    const next = createChatSearchIndex(updated, index);
    expect(getChatSearchNormalizationCount()).toBe(3);
    expect(findChatSearchMatches(updated, "build", next).map((match) => match.messageId)).toEqual(["a"]);
  });
  it("returns no matches for empty queries and excludes console messages", () => {
    const messages = [message("console", "console", "build build"), message("a", "assistant", "build")];
    expect(findChatSearchMatches(messages, "   ")).toEqual([]);
    expect(findChatSearchMatches(messages, "build").map((match) => match.messageId)).toEqual(["a"]);
  });
});
