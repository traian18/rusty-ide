import { describe, expect, it } from "vitest";

import { PROMPT_HISTORY_SIZE, recentPrompts, userPrompts, type PromptSource } from "./promptHistory";

const chat = (savedAt: string, ...prompts: string[]): PromptSource => ({ savedAt, prompts });

describe("userPrompts", () => {
  it("keeps what the person sent, in order, and nothing the agent or the tools said", () => {
    expect(
      userPrompts([
        { role: "user", content: "first" },
        { role: "assistant", content: "ok" },
        { role: "tool-result", content: "x" },
        { role: "user", content: "second" },
      ]),
    ).toEqual(["first", "second"]);
  });
});

describe("recentPrompts", () => {
  it("offers the last five, newest first", () => {
    expect(recentPrompts(["a", "b", "c", "d", "e", "f", "g"], [])).toEqual(["g", "f", "e", "d", "c"]);
    expect(PROMPT_HISTORY_SIZE).toBe(5);
  });

  it("takes from earlier chats only for what this chat cannot fill, newest chat first", () => {
    const previous = [chat("2026-09-29", "old-1", "old-2"), chat("2026-09-30", "mid-1", "mid-2", "mid-3")];
    expect(recentPrompts(["now-1", "now-2"], previous)).toEqual(["now-2", "now-1", "mid-3", "mid-2", "mid-1"]);
    expect(recentPrompts([], previous)).toEqual(["mid-3", "mid-2", "mid-1", "old-2", "old-1"]);
  });

  it("does not reach into earlier chats when this one has enough", () => {
    expect(recentPrompts(["1", "2", "3", "4", "5", "6"], [chat("2026-09-30", "older")])).toEqual(["6", "5", "4", "3", "2"]);
  });

  it("shows a prompt once, at its latest place, even when this chat is also among the saved ones", () => {
    const saved = [chat("2026-10-01T10:00:00Z", "fix the build", "add tests")];
    expect(recentPrompts(["fix the build", "add tests", "ship it"], saved)).toEqual(["ship it", "add tests", "fix the build"]);
    expect(recentPrompts(["run it", "other", "run it"], [])).toEqual(["run it", "other"]);
  });

  it("treats prompts that differ only in surrounding whitespace as the same, and drops blank ones", () => {
    expect(recentPrompts(["  hello ", "", "   ", "hello"], [])).toEqual(["hello"]);
  });

  it("orders saved chats by when they were saved, with undated ones last", () => {
    const previous = [chat("", "undated"), chat("2026-10-01", "newer"), chat("2026-09-01", "older")];
    expect(recentPrompts([], previous)).toEqual(["newer", "older", "undated"]);
  });

  it("copes with nothing at all, and with a smaller or larger limit", () => {
    expect(recentPrompts([], [])).toEqual([]);
    expect(recentPrompts(["a", "b", "c"], [], 2)).toEqual(["c", "b"]);
    expect(recentPrompts(["a", "b", "c"], [], 10)).toEqual(["c", "b", "a"]);
  });

  it("does not change what it was given", () => {
    const current = ["a", "b"];
    const previous = [chat("2", "x"), chat("1", "y")];
    recentPrompts(current, previous);
    expect(current).toEqual(["a", "b"]);
    expect(previous.map((source) => source.savedAt)).toEqual(["2", "1"]);
  });
});
