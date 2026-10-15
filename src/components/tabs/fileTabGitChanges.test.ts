import { describe, expect, it } from "vitest";
import { computeLineChanges, toGutterDecorations } from "./fileTabGitChanges";

describe("computeLineChanges", () => {
  it("returns nothing for identical text", () => {
    expect(computeLineChanges("a\nb\n", "a\nb\n")).toEqual([]);
  });
  it("marks every line added for an untracked file", () => {
    expect(computeLineChanges("", "a\nb\nc")).toEqual([{ start: 1, end: 3, kind: "added" }]);
  });
  it("detects inserted lines", () => {
    expect(computeLineChanges("a\nc\n", "a\nb\nc\n")).toEqual([{ start: 2, end: 2, kind: "added" }]);
  });
  it("detects modified lines", () => {
    expect(computeLineChanges("a\nb\nc\n", "a\nB\nc\n")).toEqual([{ start: 2, end: 2, kind: "modified" }]);
  });
  it("detects deletions at the line below", () => {
    expect(computeLineChanges("a\nb\nc\n", "a\nc\n")).toEqual([{ start: 2, end: 2, kind: "deleted" }]);
  });
  it("handles multiple separate hunks", () => {
    expect(computeLineChanges("a\nb\nc\nd\ne\n", "a\nX\nc\nd\ne\nf\n")).toEqual([
      { start: 2, end: 2, kind: "modified" },
      { start: 6, end: 6, kind: "added" },
    ]);
  });
  it("clamps a trailing deletion to the last line", () => {
    expect(computeLineChanges("a\nb\n", "a\n")).toEqual([{ start: 1, end: 1, kind: "deleted" }]);
  });
});

describe("toGutterDecorations", () => {
  it("maps kinds to CSS classes", () => {
    const [d] = toGutterDecorations([{ start: 2, end: 4, kind: "added" }]);
    expect(d.range.startLineNumber).toBe(2);
    expect(d.range.endLineNumber).toBe(4);
    expect(d.options.linesDecorationsClassName).toContain("git-gutter-added");
  });
});
