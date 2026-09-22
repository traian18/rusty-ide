import { describe, expect, it } from "vitest";
import { ChatScrollFollow } from "./chatScrollFollow";

describe("chat scroll following", () => {
  it("follows live content growth until the reader scrolls away", () => {
    const state = new ChatScrollFollow();
    expect(state.shouldFollow(true)).toBe(true);
    state.update(300);
    expect(state.shouldFollow(true)).toBe(false);
    state.update(20);
    expect(state.shouldFollow(true)).toBe(true);
  });

  it("honors surfaces that disable follow mode", () => {
    expect(new ChatScrollFollow().shouldFollow(false)).toBe(false);
  });
});
