// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { agentChatScrollKey, forgetScroll, persistScroll, recallScroll, rememberScroll } from "./chatScrollMemory";

afterEach(() => localStorage.clear());

describe("chat scroll memory", () => {
  it("knows nothing of a scroller never scrolled", () => {
    expect(recallScroll("never")).toBeUndefined();
  });

  it("keeps each key's offset and pinned state apart", () => {
    rememberScroll("one", { top: 40, pinned: false });
    rememberScroll("two", { top: 900, pinned: true });
    expect(recallScroll("one")).toEqual({ top: 40, pinned: false });
    expect(recallScroll("two")).toEqual({ top: 900, pinned: true });
  });

  it("writes to storage only when persisted, and reads it back after a restart", () => {
    rememberScroll("stored", { top: 75, pinned: true });
    expect(localStorage.getItem("chat_scroll_stored")).toBeNull();
    persistScroll("stored");
    expect(JSON.parse(localStorage.getItem("chat_scroll_stored")!)).toEqual({ top: 75, pinned: true });
  });

  it("reads an offset an earlier build stored alone, and ignores what is not a position", () => {
    localStorage.setItem("chat_scroll_legacy", "120");
    localStorage.setItem("chat_scroll_junk", "{\"nope\":1}");
    localStorage.setItem("chat_scroll_broken", "{");
    expect(recallScroll("legacy")).toEqual({ top: 120, pinned: false });
    expect(recallScroll("junk")).toBeUndefined();
    expect(recallScroll("broken")).toBeUndefined();
  });

  it("forgets a closed chat's position, in memory and in storage", () => {
    const key = agentChatScrollKey("chat-1");
    rememberScroll(key, { top: 10, pinned: false });
    persistScroll(key);
    forgetScroll(key);
    expect(recallScroll(key)).toBeUndefined();
    expect(localStorage.getItem(`chat_scroll_${key}`)).toBeNull();
  });
});
