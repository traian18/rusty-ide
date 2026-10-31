// ============================================================
// fileState/rereads.ts -- a session reads a file it already read, and the
// file has changed since (usually by its own edit). Instead of the whole
// file again, it gets what changed, numbered as the file is now, plus the
// header so it knows where it is. Works on read_file's exact-range format:
//
//   File: src/policy.rs (340 lines)
//   [lines 1-340]
//   <the lines>
//
// Anything else (a Smart Read excerpt, a different range) is left alone.
// ============================================================

import { changedRegion, numbered, REGION_LIMITS } from "./region";

interface ParsedRead {
  path: string;
  total: number;
  start: number;
  end: number;
  lines: string[];
}

const HEADER = /^File: (.+) \((\d+) lines\)\n\[lines (\d+)-(\d+)\]\n/;

export function parseRead(output: string): ParsedRead | undefined {
  const m = HEADER.exec(output);
  if (!m) return undefined;
  const body = output.slice(m[0].length).split("\n");
  // A trailing "[Range limit ...]" note is not file content.
  const note = body.findIndex((line, i) => i > 0 && body[i - 1] === "" && /^\[Range limit/.test(line));
  return { path: m[1], total: Number(m[2]), start: Number(m[3]), end: Number(m[4]), lines: note > 0 ? body.slice(0, note - 1) : body };
}

/** Share of the new text the change may cover and still be sent as a change. */
const MAX_CHANGED_SHARE = 0.5;

/**
 * The reply to a re-read of a changed file: only the changed lines with a few
 * around them, or undefined when the change is too large or the reads are not
 * comparable (then the full result goes).
 */
export function changeSinceLastRead(previous: string, next: string, recallId: string): string | undefined {
  const before = parseRead(previous);
  const after = parseRead(next);
  if (!before || !after || before.path !== after.path || before.start !== after.start) return undefined;
  const region = changedRegion(before.lines, after.lines);
  if (!region) return undefined;
  const changed = Math.max(region.endAfter - region.start, 1);
  if (changed > Math.max(REGION_LIMITS.maxShownLines, after.lines.length * MAX_CHANGED_SHARE)) return undefined;
  const from = Math.max(0, region.start - REGION_LIMITS.contextLines);
  const to = Math.min(after.lines.length, region.endAfter + REGION_LIMITS.contextLines);
  const removed = region.endBefore - region.start - (region.endAfter - region.start);
  const net = removed > 0 ? ` (${removed} fewer lines than before)` : removed < 0 ? ` (${-removed} more lines than before)` : "";
  return [
    `File: ${after.path} (${after.total} lines)`,
    `[Changed since this session last read it${net}; every other line is as it was then. Lines ${after.start + from}-${after.start + to - 1} now read:]`,
    to > from ? numbered(after.lines, from, to, after.start) : `[the change removed lines ${after.start + region.start}-${after.start + region.endBefore - 1}]`,
    `[Whole file as it is now: job_output id="${recallId}"]`,
  ].join("\n");
}
