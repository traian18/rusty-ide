import { describe, expect, it } from "vitest";
import {
  alignmentZones,
  buildChunks,
  chunkEdit,
  chunkText,
  createMergeDocument,
  hasConflictMarkers,
  initialResult,
  replaceRange,
  shiftRanges,
  splitLines,
  unresolvedIndexes,
} from "./mergeModel";
import type { ConflictFile, LineHunk } from "./model";

const hunk = (baseStart: number, baseEnd: number, sideStart: number, sideEnd: number): LineHunk => ({ baseStart, baseEnd, sideStart, sideEnd });
const text = (...lines: string[]) => lines.map((line) => `${line}\n`).join("");

function conflictFile(overrides: Partial<ConflictFile>): ConflictFile {
  return {
    path: "/repo/a.ts",
    relativePath: "a.ts",
    kind: "content",
    binary: false,
    base: "",
    local: "",
    incoming: "",
    working: null,
    localHunks: [],
    incomingHunks: [],
    ...overrides,
  };
}

const none = { localLines: [], incomingLines: [] };

describe("splitLines", () => {
  it("keeps line endings, so joining gives the text back", () => {
    expect(splitLines("a\nb\r\nc")).toEqual(["a\n", "b\r\n", "c"]);
    expect(splitLines("a\n")).toEqual(["a\n"]);
    expect(splitLines("")).toEqual([]);
  });
});

describe("buildChunks", () => {
  it("leaves changes on different lines to merge by themselves", () => {
    const chunks = buildChunks([hunk(1, 2, 1, 2)], [hunk(5, 6, 5, 7)], none);

    expect(chunks.map((chunk) => chunk.kind)).toEqual(["local", "incoming"]);
    expect(chunks[1].local).toEqual({ start: 5, end: 6 });
    expect(chunks[1].incoming).toEqual({ start: 5, end: 7 });
  });

  it("shifts a side's ranges by that side's earlier changes", () => {
    const chunks = buildChunks([hunk(1, 1, 1, 4)], [hunk(5, 6, 5, 6)], none);

    expect(chunks[1].local).toEqual({ start: 8, end: 9 });
    expect(chunks[1].incoming).toEqual({ start: 5, end: 6 });
  });

  it("treats overlapping changes as a conflict", () => {
    const lines = { localLines: ["a\n", "L\n", "c\n", "d\n"], incomingLines: ["a\n", "b\n", "I\n", "d\n"] };

    const [chunk] = buildChunks([hunk(1, 2, 1, 2)], [hunk(1, 3, 1, 3)], lines);

    expect(chunk.kind).toBe("conflict");
    expect(chunk.base).toEqual({ start: 1, end: 3 });
    expect(chunk.local).toEqual({ start: 1, end: 3 });
  });

  it("treats changes that only touch as a conflict, as git does", () => {
    const chunks = buildChunks([hunk(1, 2, 1, 2)], [hunk(2, 3, 2, 3)], { localLines: ["a\n", "L\n", "c\n"], incomingLines: ["a\n", "b\n", "I\n"] });

    expect(chunks).toHaveLength(1);
    expect(chunks[0].kind).toBe("conflict");
    expect(chunks[0].base).toEqual({ start: 1, end: 3 });
  });

  it("merges one conflict through a chain of changes", () => {
    const chunks = buildChunks([hunk(0, 2, 0, 2), hunk(3, 5, 3, 5)], [hunk(1, 4, 1, 4)], { localLines: ["x\n"], incomingLines: ["y\n"] });

    expect(chunks).toHaveLength(1);
    expect(chunks[0].base).toEqual({ start: 0, end: 5 });
  });

  it("accepts the same change on both sides without asking", () => {
    const lines = { localLines: ["a\n", "same\n"], incomingLines: ["a\n", "same\n"] };

    expect(buildChunks([hunk(1, 2, 1, 2)], [hunk(1, 2, 1, 2)], lines)[0].kind).toBe("same");
  });

  it("sees two insertions at one place as a conflict", () => {
    const [chunk] = buildChunks([hunk(2, 2, 2, 3)], [hunk(2, 2, 2, 4)], { localLines: ["a\n", "b\n", "L\n"], incomingLines: ["a\n", "b\n", "I\n", "J\n"] });

    expect(chunk.kind).toBe("conflict");
    expect(chunk.local).toEqual({ start: 2, end: 3 });
    expect(chunk.incoming).toEqual({ start: 2, end: 4 });
  });
});

describe("the merged text", () => {
  const file = conflictFile({
    base: text("one", "two", "three", "four", "five"),
    local: text("one", "LOCAL", "three", "four", "five", "six"),
    incoming: text("ONE", "INCOMING", "three", "four", "five"),
    localHunks: [hunk(1, 2, 1, 2), hunk(5, 5, 5, 6)],
    incomingHunks: [hunk(0, 2, 0, 2)],
  });
  const doc = createMergeDocument(file);

  it("applies what merges by itself and shows the common text for a conflict", () => {
    const { text: merged, ranges } = initialResult(doc);

    expect(doc.chunks.map((chunk) => chunk.kind)).toEqual(["conflict", "local"]);
    expect(merged).toBe(text("one", "two", "three", "four", "five", "six"));
    expect(ranges).toEqual([{ start: 0, end: 2 }, { start: 5, end: 6 }]);
  });

  it("gives each choice its own text", () => {
    const [conflict] = doc.chunks;

    expect(chunkText(doc, conflict, "local")).toBe(text("one", "LOCAL"));
    expect(chunkText(doc, conflict, "incoming")).toBe(text("ONE", "INCOMING"));
    expect(chunkText(doc, conflict, "both")).toBe(text("one", "LOCAL", "ONE", "INCOMING"));
    expect(chunkText(doc, conflict, "base")).toBe(text("one", "two"));
  });

  it("ends a local last line before adding the incoming lines after it", () => {
    const noNewline = createMergeDocument(conflictFile({
      base: "a\nb",
      local: "a\nL",
      incoming: "a\nI",
      localHunks: [hunk(1, 2, 1, 2)],
      incomingHunks: [hunk(1, 2, 1, 2)],
    }));

    expect(chunkText(noNewline, noNewline.chunks[0], "both")).toBe("L\nI");
  });

  it("counts every conflict until it is decided", () => {
    expect(unresolvedIndexes(doc, ["unresolved", "unresolved"])).toEqual([0]);
    expect(unresolvedIndexes(doc, ["both", "unresolved"])).toEqual([]);
  });

  it("makes everything a conflict when both sides added the file", () => {
    const added = createMergeDocument(conflictFile({
      base: null,
      local: text("same", "local"),
      incoming: text("same", "incoming"),
      incomingHunks: [hunk(1, 2, 1, 2)],
    }));

    expect(added.chunks.map((chunk) => chunk.kind)).toEqual(["conflict"]);
    expect(chunkText(added, added.chunks[0], "incoming")).toBe(text("incoming"));
  });

  it("recognises git's markers but not a line that merely looks like one", () => {
    expect(hasConflictMarkers("a\n<<<<<<< HEAD\nb\n=======\nc\n>>>>>>> main\n")).toBe(true);
    expect(hasConflictMarkers("a\nb\n")).toBe(false);
    expect(hasConflictMarkers("<<<<<<<<<< not one\n")).toBe(false);
  });
});

describe("chunkEdit", () => {
  it("replaces whole lines in the middle of a result", () => {
    expect(chunkEdit({ start: 1, end: 3 }, "x\n", 6, 1)).toEqual({ startLine: 2, startColumn: 1, endLine: 4, endColumn: 1, text: "x\n" });
  });

  it("ends a replacement that has text after it", () => {
    expect(chunkEdit({ start: 1, end: 3 }, "x", 6, 1).text).toBe("x\n");
  });

  it("stops at the last column of a file with no final newline", () => {
    expect(chunkEdit({ start: 1, end: 2 }, "x", 2, 4)).toEqual({ startLine: 2, startColumn: 1, endLine: 2, endColumn: 4, text: "x" });
  });

  it("starts a new line for an empty chunk after a last line with no newline", () => {
    expect(chunkEdit({ start: 2, end: 2 }, "x", 2, 4)).toEqual({ startLine: 2, startColumn: 4, endLine: 2, endColumn: 4, text: "\nx" });
  });
});

describe("tracking chunks through edits", () => {
  const ranges = [{ start: 2, end: 4 }, { start: 8, end: 8 }, { start: 10, end: 12 }];

  it("moves the chunks after an edit and no others", () => {
    const { ranges: shifted, touched } = shiftRanges(ranges, { startLine: 5, endLine: 5, lineDelta: 2 });

    expect(shifted).toEqual([{ start: 2, end: 4 }, { start: 10, end: 10 }, { start: 12, end: 14 }]);
    expect(touched).toEqual([]);
  });

  it("grows a chunk edited inside and reports it", () => {
    const { ranges: shifted, touched } = shiftRanges(ranges, { startLine: 3, endLine: 3, lineDelta: 1 });

    expect(shifted[0]).toEqual({ start: 2, end: 5 });
    expect(shifted[1]).toEqual({ start: 9, end: 9 });
    expect(touched).toEqual([0]);
  });

  it("never lets a chunk's end pass its start when lines are deleted", () => {
    const { ranges: shifted } = shiftRanges(ranges, { startLine: 2, endLine: 5, lineDelta: -3 });

    expect(shifted[0]).toEqual({ start: 2, end: 2 });
  });

  it("resizes a chunk for a choice and moves those after it", () => {
    expect(replaceRange(ranges, 0, 5)).toEqual([{ start: 2, end: 7 }, { start: 11, end: 11 }, { start: 13, end: 15 }]);
  });
});

describe("alignmentZones", () => {
  it("pads the shorter panes level with the tallest, after the chunk", () => {
    const chunks = [{ kind: "conflict" as const, base: { start: 1, end: 2 }, local: { start: 1, end: 2 }, incoming: { start: 1, end: 4 } }];

    const zones = alignmentZones(chunks, [{ start: 1, end: 2 }]);

    expect(zones.incoming).toEqual([{ afterLine: 1, lines: 1, chunk: 0, header: true }]);
    expect(zones.local).toEqual([{ afterLine: 1, lines: 1, chunk: 0, header: true }, { afterLine: 2, lines: 2, chunk: 0 }]);
    expect(zones.result).toEqual([{ afterLine: 1, lines: 1, chunk: 0, header: true }, { afterLine: 2, lines: 2, chunk: 0 }]);
  });

  it("gives only conflicts a row of buttons", () => {
    const chunks = [{ kind: "incoming" as const, base: { start: 1, end: 1 }, local: { start: 1, end: 1 }, incoming: { start: 1, end: 3 } }];

    const zones = alignmentZones(chunks, [{ start: 1, end: 3 }]);

    expect(zones.result).toEqual([]);
    expect(zones.local).toEqual([{ afterLine: 1, lines: 2, chunk: 0 }]);
  });

  it("keeps later chunks level after lines were typed between chunks", () => {
    const chunks = [
      { kind: "local" as const, base: { start: 0, end: 1 }, local: { start: 0, end: 1 }, incoming: { start: 0, end: 1 } },
      { kind: "local" as const, base: { start: 3, end: 4 }, local: { start: 3, end: 4 }, incoming: { start: 3, end: 4 } },
    ];

    // Two lines typed into the result between the chunks.
    const zones = alignmentZones(chunks, [{ start: 0, end: 1 }, { start: 5, end: 6 }]);

    expect(zones.local).toEqual([{ afterLine: 3, lines: 2, chunk: undefined }]);
    expect(zones.incoming).toEqual([{ afterLine: 3, lines: 2, chunk: undefined }]);
    expect(zones.result).toEqual([]);
  });

  it("makes every pane the same height, whatever the chunks", () => {
    const chunks = [
      { kind: "conflict" as const, base: { start: 2, end: 4 }, local: { start: 2, end: 3 }, incoming: { start: 2, end: 7 } },
      { kind: "local" as const, base: { start: 8, end: 8 }, local: { start: 7, end: 10 }, incoming: { start: 11, end: 11 } },
    ];
    const ranges = [{ start: 2, end: 4 }, { start: 8, end: 11 }];

    const zones = alignmentZones(chunks, ranges);
    const height = (pane: "local" | "result" | "incoming", ends: number) =>
      ends + zones[pane].reduce((sum, zone) => sum + zone.lines, 0);

    expect(new Set([height("local", 10), height("result", 11), height("incoming", 11)]).size).toBe(1);
  });
});
