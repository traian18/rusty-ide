// ============================================================
// fileState/region.ts -- where two versions of a text differ, and how to
// show that part with its line numbers. One region covers everything
// between the first and the last changed line (a prefix/suffix
// comparison): exact for the usual single edit, and still correct, if
// wider, for several. Shared by the edit tools (show what an edit left)
// and by re-reads (show what changed since the session last read a file).
// ============================================================

export interface Region {
  /** First changed line, 0-based, the same in both versions. */
  start: number;
  /** One past the last changed line in the old version. */
  endBefore: number;
  /** One past the last changed line in the new version. */
  endAfter: number;
}

export const REGION_LIMITS = {
  /** Unchanged lines shown around a change. */
  contextLines: 3,
  /** More changed lines than this are shown as head and tail. */
  maxShownLines: 60,
} as const;

/** The changed region, or undefined when the texts are equal. */
export function changedRegion(before: readonly string[], after: readonly string[]): Region | undefined {
  let start = 0;
  while (start < before.length && start < after.length && before[start] === after[start]) start += 1;
  if (start === before.length && start === after.length) return undefined;
  let endBefore = before.length;
  let endAfter = after.length;
  while (endBefore > start && endAfter > start && before[endBefore - 1] === after[endAfter - 1]) {
    endBefore -= 1;
    endAfter -= 1;
  }
  return { start, endBefore, endAfter };
}

/** `lines` from 0-based `from` to `to` (exclusive), numbered as file lines from `firstLine`, capped. */
export function numbered(lines: readonly string[], from: number, to: number, firstLine = 1): string {
  const shown = (index: number) => `${index + firstLine}: ${lines[index]}`;
  const count = to - from;
  if (count <= REGION_LIMITS.maxShownLines) return Array.from({ length: count }, (_, i) => shown(from + i)).join("\n");
  const head = Math.floor(REGION_LIMITS.maxShownLines * 0.7);
  const tail = REGION_LIMITS.maxShownLines - head;
  return [
    ...Array.from({ length: head }, (_, i) => shown(from + i)),
    `[... ${count - head - tail} lines ...]`,
    ...Array.from({ length: tail }, (_, i) => shown(to - tail + i)),
  ].join("\n");
}

/** What an edit left in the file: the changed lines and a few around them, numbered, for the edit tool's result. */
export function describeEdit(previous: string, next: string): string {
  const before = previous.split(/\r?\n/);
  const after = next.split(/\r?\n/);
  const region = changedRegion(before, after);
  if (!region) return "";
  const from = Math.max(0, region.start - REGION_LIMITS.contextLines);
  const to = Math.min(after.length, region.endAfter + REGION_LIMITS.contextLines);
  const size = `${after.length} ${after.length === 1 ? "line" : "lines"}`;
  if (to <= from) return `\nThe file now has ${size}; the change removed lines ${region.start + 1}-${region.endBefore}.`;
  return `\nThe file now has ${size}. Lines ${from + 1}-${to} now read:\n${numbered(after, from, to)}`;
}
