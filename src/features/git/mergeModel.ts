/**
 * The merge window's logic: lines up what each side did to the common version,
 * builds the merged text, and works out how to keep the three panes level.
 * Pure, so it is tested without Monaco. Line numbers are 0-based and ranges
 * half-open, as `git_conflict_file` sends them.
 */
import type { ConflictFile, LineHunk } from "./model";

export interface LineRange {
  start: number;
  end: number;
}

/**
 * One place where the sides differ from the common version. "local" and
 * "incoming" changed on one side only and merge by themselves, "same" changed
 * identically on both, and "conflict" needs a decision.
 */
export interface MergeChunk {
  kind: "local" | "incoming" | "same" | "conflict";
  base: LineRange;
  local: LineRange;
  incoming: LineRange;
}

/** How a conflict was settled. "manual" means the result was edited inside it. */
export type ChunkChoice = "unresolved" | "local" | "incoming" | "both" | "base" | "manual";

export interface MergeDocument {
  baseLines: string[];
  localLines: string[];
  incomingLines: string[];
  chunks: MergeChunk[];
}

/** Lines with their endings, so joining them gives the text back unchanged. */
export function splitLines(text: string): string[] {
  return text.match(/[^\n]*\n|[^\n]+$/g) ?? [];
}

function sameLines(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((line, index) => line === b[index]);
}

const lengthChange = (hunk: LineHunk) => hunk.sideEnd - hunk.sideStart - (hunk.baseEnd - hunk.baseStart);

/**
 * Walks both sides' hunks along the common version. Hunks that overlap or
 * touch belong together, which is the same rule git's merge uses, and a group
 * with changes from both sides is a conflict unless they are the same change.
 */
export function buildChunks(
  localHunks: LineHunk[],
  incomingHunks: LineHunk[],
  lines: Pick<MergeDocument, "localLines" | "incomingLines">,
): MergeChunk[] {
  const chunks: MergeChunk[] = [];
  let localIndex = 0;
  let incomingIndex = 0;
  let localShift = 0;
  let incomingShift = 0;

  while (localIndex < localHunks.length || incomingIndex < incomingHunks.length) {
    const nextLocal = localHunks[localIndex];
    const nextIncoming = incomingHunks[incomingIndex];
    const first = !nextIncoming || (nextLocal && nextLocal.baseStart <= nextIncoming.baseStart) ? nextLocal : nextIncoming;
    const base: LineRange = { start: first.baseStart, end: first.baseEnd };
    const localStartShift = localShift;
    const incomingStartShift = incomingShift;
    let touchedLocal = false;
    let touchedIncoming = false;

    for (;;) {
      const local = localHunks[localIndex];
      const incoming = incomingHunks[incomingIndex];
      if (local && local.baseStart <= base.end) {
        base.end = Math.max(base.end, local.baseEnd);
        localShift += lengthChange(local);
        touchedLocal = true;
        localIndex += 1;
      } else if (incoming && incoming.baseStart <= base.end) {
        base.end = Math.max(base.end, incoming.baseEnd);
        incomingShift += lengthChange(incoming);
        touchedIncoming = true;
        incomingIndex += 1;
      } else {
        break;
      }
    }

    const local = { start: base.start + localStartShift, end: base.end + localShift };
    const incoming = { start: base.start + incomingStartShift, end: base.end + incomingShift };
    const kind = !touchedIncoming
      ? "local"
      : !touchedLocal
        ? "incoming"
        : sameLines(lines.localLines.slice(local.start, local.end), lines.incomingLines.slice(incoming.start, incoming.end))
          ? "same"
          : "conflict";
    chunks.push({ kind, base, local, incoming });
  }
  return chunks;
}

export function createMergeDocument(file: ConflictFile): MergeDocument {
  const localLines = splitLines(file.local ?? "");
  const incomingLines = splitLines(file.incoming ?? "");
  // Both sides added the file, so there is no common version: every difference
  // is a conflict, and git compared incoming against local to find them.
  if (file.base === null) {
    return {
      baseLines: localLines,
      localLines,
      incomingLines,
      chunks: buildChunks([], file.incomingHunks, { localLines, incomingLines }).map((chunk) => ({ ...chunk, kind: "conflict" })),
    };
  }
  return {
    baseLines: splitLines(file.base),
    localLines,
    incomingLines,
    chunks: buildChunks(file.localHunks, file.incomingHunks, { localLines, incomingLines }),
  };
}

const slice = (lines: string[], range: LineRange) => lines.slice(range.start, range.end).join("");

/** A last line with no newline must get one before more text follows it. */
export function terminated(text: string): string {
  return text === "" || text.endsWith("\n") ? text : `${text}\n`;
}

/** The text a chunk contributes to the result for a choice. */
export function chunkText(doc: MergeDocument, chunk: MergeChunk, choice: ChunkChoice = "unresolved"): string {
  if (chunk.kind === "incoming") return slice(doc.incomingLines, chunk.incoming);
  if (chunk.kind !== "conflict") return slice(doc.localLines, chunk.local);
  switch (choice) {
    case "local":
      return slice(doc.localLines, chunk.local);
    case "incoming":
      return slice(doc.incomingLines, chunk.incoming);
    case "both":
      return terminated(slice(doc.localLines, chunk.local)) + slice(doc.incomingLines, chunk.incoming);
    default:
      // An undecided conflict shows the common version, as both IntelliJ and VS Code do.
      return slice(doc.baseLines, chunk.base);
  }
}

export interface MergeResult {
  text: string;
  /** Where each chunk landed in `text`. */
  ranges: LineRange[];
}

/** The merged text with every change that merges by itself applied and every conflict undecided. */
export function initialResult(doc: MergeDocument): MergeResult {
  let text = "";
  let line = 0;
  let baseLine = 0;
  const ranges: LineRange[] = [];
  const append = (piece: string) => {
    // A piece that does not end the file has to end its last line.
    text = terminated(text) + piece;
    line += splitLines(piece).length;
  };
  for (const chunk of doc.chunks) {
    append(doc.baseLines.slice(baseLine, chunk.base.start).join(""));
    const start = line;
    append(chunkText(doc, chunk));
    ranges.push({ start, end: line });
    baseLine = chunk.base.end;
  }
  append(doc.baseLines.slice(baseLine).join(""));
  return { text, ranges };
}

/** True when the file on disk still has git's conflict markers in it. */
export function hasConflictMarkers(text: string): boolean {
  return /^<{7}( |$)/m.test(text) && /^>{7}( |$)/m.test(text);
}

/** The conflicts still waiting for a decision. */
export function unresolvedIndexes(doc: MergeDocument, choices: ChunkChoice[]): number[] {
  return doc.chunks.flatMap((chunk, index) => (chunk.kind === "conflict" && choices[index] === "unresolved" ? [index] : []));
}

/** One replacement in the result, in Monaco's 1-based positions. */
export interface ChunkEdit {
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
  text: string;
}

/**
 * Replaces a chunk's lines in a result of `lineCount` lines whose last line has
 * `lastColumn` as its end. A chunk at the very end of a file with no final
 * newline has no following line to end at, so it ends on its own last column.
 */
export function chunkEdit(range: LineRange, text: string, lineCount: number, lastColumn: number): ChunkEdit {
  if (range.start >= lineCount) {
    return { startLine: lineCount, startColumn: lastColumn, endLine: lineCount, endColumn: lastColumn, text: `\n${text}` };
  }
  if (range.end >= lineCount) {
    return { startLine: range.start + 1, startColumn: 1, endLine: lineCount, endColumn: lastColumn, text };
  }
  return { startLine: range.start + 1, startColumn: 1, endLine: range.end + 1, endColumn: 1, text: terminated(text) };
}

/** A change to the result, in 0-based lines; `lineDelta` is how many lines it added. */
export interface LineEdit {
  startLine: number;
  endLine: number;
  lineDelta: number;
}

/**
 * Keeps each chunk's place in the result across an edit. Chunks past the edit
 * move with it; `touched` lists those the edit landed inside.
 */
export function shiftRanges(ranges: LineRange[], edit: LineEdit): { ranges: LineRange[]; touched: number[] } {
  const touched: number[] = [];
  const shifted = ranges.map((range, index) => {
    if (edit.endLine < range.start) return { start: range.start + edit.lineDelta, end: range.end + edit.lineDelta };
    if (edit.startLine >= range.end) return range;
    touched.push(index);
    const start = Math.min(range.start, edit.startLine);
    return { start, end: Math.max(start, range.end + edit.lineDelta) };
  });
  return { ranges: shifted, touched };
}

/** Puts `lineCount` lines where the chunk was and moves everything after it. */
export function replaceRange(ranges: LineRange[], index: number, lineCount: number): LineRange[] {
  const delta = lineCount - (ranges[index].end - ranges[index].start);
  return ranges.map((range, position) => {
    if (position < index) return range;
    if (position === index) return { start: range.start, end: range.start + lineCount };
    return { start: range.start + delta, end: range.end + delta };
  });
}

export type MergePane = "local" | "result" | "incoming";

const PANES: MergePane[] = ["local", "result", "incoming"];

/** Blank space in a pane, after a line (0 is above the first). */
export interface PaneZone {
  afterLine: number;
  lines: number;
  /** The chunk this pads, so it can share its tint. Absent between chunks. */
  chunk?: number;
  /** The row that holds a conflict's buttons. */
  header?: boolean;
}

export type PaneZones = Record<MergePane, PaneZone[]>;

/**
 * Lines the panes up. The sides and the result have different line counts in
 * and around each chunk, so the shorter ones get blank space; with it, the same
 * scroll position shows the same chunk in all three. Each conflict also gets a
 * row above it for its buttons.
 */
export function alignmentZones(chunks: MergeChunk[], ranges: LineRange[]): PaneZones {
  const zones: PaneZones = { local: [], result: [], incoming: [] };
  const reached: Record<MergePane, number> = { local: 0, result: 0, incoming: 0 };
  const level = (ends: Record<MergePane, number>, chunk?: number) => {
    const lengths = PANES.map((pane) => ends[pane] - reached[pane]);
    const tallest = Math.max(...lengths);
    PANES.forEach((pane, index) => {
      const lines = tallest - lengths[index];
      if (lines > 0) zones[pane].push({ afterLine: ends[pane], lines, chunk });
      reached[pane] = ends[pane];
    });
  };
  chunks.forEach((chunk, index) => {
    const range = ranges[index];
    level({ local: chunk.local.start, result: range.start, incoming: chunk.incoming.start });
    if (chunk.kind === "conflict") {
      for (const pane of PANES) zones[pane].push({ afterLine: reached[pane], lines: 1, chunk: index, header: true });
    }
    level({ local: chunk.local.end, result: range.end, incoming: chunk.incoming.end }, index);
  });
  return zones;
}
