import { describe, expect, it } from "vitest";

import { CLOSED, stepPromptMenu, type PromptKeyContext, type PromptMenuState } from "./promptHistoryNav";

const prompts = ["oldest", "middle", "newest"];
const context = (overrides: Partial<PromptKeyContext> = {}): PromptKeyContext => ({ prompts, value: "", caretAtStart: true, ...overrides });
const open = (index: number): PromptMenuState => ({ open: true, index });

describe("opening the menu", () => {
  it("opens on the newest prompt when up is pressed in an empty box", () => {
    expect(stepPromptMenu(CLOSED, { key: "ArrowUp" }, context())).toEqual({ handled: true, state: open(2) });
  });

  it("opens from the very start of a draft, but leaves up alone anywhere else in it, so the caret still moves", () => {
    expect(stepPromptMenu(CLOSED, { key: "ArrowUp" }, context({ value: "a draft", caretAtStart: true })).state).toEqual(open(2));
    expect(stepPromptMenu(CLOSED, { key: "ArrowUp" }, context({ value: "a draft", caretAtStart: false }))).toEqual({ handled: false, state: CLOSED });
  });

  it("does nothing with no earlier prompts, while the box is unavailable, or for a modified or other key", () => {
    expect(stepPromptMenu(CLOSED, { key: "ArrowUp" }, context({ prompts: [] })).handled).toBe(false);
    expect(stepPromptMenu(CLOSED, { key: "ArrowUp" }, context({ disabled: true })).handled).toBe(false);
    expect(stepPromptMenu(CLOSED, { key: "ArrowUp", shiftKey: true }, context()).handled).toBe(false);
    expect(stepPromptMenu(CLOSED, { key: "ArrowUp", metaKey: true }, context()).handled).toBe(false);
    expect(stepPromptMenu(CLOSED, { key: "ArrowUp", isComposing: true }, context()).handled).toBe(false);
    expect(stepPromptMenu(CLOSED, { key: "ArrowDown" }, context()).handled).toBe(false);
    expect(stepPromptMenu(CLOSED, { key: "a" }, context()).handled).toBe(false);
  });
});

describe("with the menu open", () => {
  it("walks back in time with up, stopping at the oldest", () => {
    expect(stepPromptMenu(open(2), { key: "ArrowUp" }, context())).toEqual({ handled: true, state: open(1) });
    expect(stepPromptMenu(open(0), { key: "ArrowUp" }, context())).toEqual({ handled: true, state: open(0) });
  });

  it("walks forward with down, and down from the newest returns to the box", () => {
    expect(stepPromptMenu(open(0), { key: "ArrowDown" }, context())).toEqual({ handled: true, state: open(1) });
    expect(stepPromptMenu(open(2), { key: "ArrowDown" }, context())).toEqual({ handled: true, state: CLOSED });
  });

  it("picks the highlighted prompt with Enter or Tab", () => {
    expect(stepPromptMenu(open(1), { key: "Enter" }, context())).toEqual({ handled: true, state: CLOSED, pick: "middle" });
    expect(stepPromptMenu(open(0), { key: "Tab" }, context())).toEqual({ handled: true, state: CLOSED, pick: "oldest" });
  });

  it("closes on Escape without picking, so a draft is untouched", () => {
    expect(stepPromptMenu(open(1), { key: "Escape" }, context({ value: "draft" }))).toEqual({ handled: true, state: CLOSED });
  });

  it("closes and lets the key through when the person carries on typing, or presses Shift+Enter", () => {
    expect(stepPromptMenu(open(1), { key: "a" }, context())).toEqual({ handled: false, state: CLOSED });
    expect(stepPromptMenu(open(1), { key: "Enter", shiftKey: true }, context())).toEqual({ handled: false, state: CLOSED });
    expect(stepPromptMenu(open(1), { key: "ArrowLeft" }, context())).toEqual({ handled: false, state: CLOSED });
  });

  it("closes when the prompts disappear from under it, and keeps the index in range when they shrink", () => {
    expect(stepPromptMenu(open(1), { key: "ArrowUp" }, context({ prompts: [] }))).toEqual({ handled: false, state: CLOSED });
    expect(stepPromptMenu(open(4), { key: "Enter" }, context())).toEqual({ handled: true, state: CLOSED, pick: "newest" });
  });
});
