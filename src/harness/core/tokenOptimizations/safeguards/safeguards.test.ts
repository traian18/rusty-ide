import { describe, expect, it, vi } from "vitest";
import { failOpen, neverWorse } from "./guards";
import { hasStamp, parseStamps, renderStamp, stampMethod } from "./stamps";

describe("stamps", () => {
  it("round-trip, with and without a recall id", () => {
    const withId = renderStamp({ action: "condensed", method: "git log", rawChars: 18_294, shownChars: 4_960, recallId: "out-3f9c2a81d4e70b5a" });
    expect(withId).toBe('[rusty:condensed git-log · 18,294->4,960 chars · full output: job_output id="out-3f9c2a81d4e70b5a" (add pattern, or start_line and end_line, to read part)]');
    expect(parseStamps(`output\n${withId}`)).toEqual([{ action: "condensed", method: "git-log", rawChars: 18_294, shownChars: 4_960, recallId: "out-3f9c2a81d4e70b5a" }]);
    const withoutId = renderStamp({ action: "condensed", method: "tests", rawChars: 2_000, shownChars: 300 });
    expect(withoutId).toBe("[rusty:condensed tests · 2,000->300 chars]");
    expect(parseStamps(withoutId)[0].recallId).toBeUndefined();
  });

  it("count only as a whole line in the stamp grammar", () => {
    expect(hasStamp("see [rusty:condensed x] in the docs")).toBe(false);
    expect(hasStamp("[rusty: just text]")).toBe(false);
    expect(hasStamp("a\n[rusty:condensed generic · 1->1 chars]\nb")).toBe(true);
  });

  it("name methods in stamp form", () => {
    expect(stampMethod("git log")).toBe("git-log");
    expect(stampMethod("")).toBe("generic");
  });
});

describe("guards", () => {
  it("never return more than the original", () => {
    expect(neverWorse("abc", "a")).toEqual({ text: "a", used: true });
    expect(neverWorse("abc", "abcd")).toEqual({ text: "abc", used: false });
  });

  it("fail open: a throwing optimisation yields the fallback", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(failOpen(() => { throw new Error("bug"); }, "original")).toBe("original");
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
    expect(failOpen(() => "optimised", "original")).toBe("optimised");
  });
});
