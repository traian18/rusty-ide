export type LineChangeKind = "added" | "modified" | "deleted";

export interface LineChange {
  /** 1-based first line in the current buffer. For "deleted", the line the removal sits above. */
  start: number;
  /** 1-based last line (inclusive). Equal to `start` for "deleted". */
  end: number;
  kind: LineChangeKind;
}

/** Above this many lines on either side the O(n*m) diff is skipped and no gutter is drawn. */
const MAX_DIFFABLE_LINES = 5000;

function splitLines(text: string): string[] {
  if (text === "") return [];
  const lines = text.split(/\r\n|\n/);
  if (lines[lines.length - 1] === "") lines.pop();
  return lines;
}

/**
 * Line-level diff of `base` (HEAD) against `current` (editor buffer), collapsed into
 * gutter ranges. An empty base means the file is untracked/new, so every line is added.
 */
export function computeLineChanges(base: string, current: string): LineChange[] {
  const a = splitLines(base);
  const b = splitLines(current);
  if (b.length === 0 && a.length === 0) return [];
  if (a.length === 0) return [{ start: 1, end: b.length, kind: "added" }];
  if (a.length > MAX_DIFFABLE_LINES || b.length > MAX_DIFFABLE_LINES) return [];

  let head = 0;
  while (head < a.length && head < b.length && a[head] === b[head]) head++;
  let tail = 0;
  while (tail < a.length - head && tail < b.length - head && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail++;

  const aMid = a.slice(head, a.length - tail);
  const bMid = b.slice(head, b.length - tail);
  const n = aMid.length;
  const m = bMid.length;

  // LCS table over the differing middle only.
  const lcs: Uint32Array[] = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i][j] = aMid[i] === bMid[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }

  const changes: LineChange[] = [];
  let i = 0;
  let j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && aMid[i] === bMid[j]) {
      i++;
      j++;
      continue;
    }
    // Collect one run of removals/additions between two matching lines.
    let removed = 0;
    let added = 0;
    const startJ = j;
    while ((i < n || j < m) && !(i < n && j < m && aMid[i] === bMid[j])) {
      if (j < m && (i >= n || lcs[i][j + 1] >= lcs[i + 1][j])) {
        j++;
        added++;
      } else {
        i++;
        removed++;
      }
    }
    const start = head + startJ + 1;
    if (added > 0 && removed > 0) changes.push({ start, end: start + added - 1, kind: "modified" });
    else if (added > 0) changes.push({ start, end: start + added - 1, kind: "added" });
    else changes.push({ start: Math.min(start, b.length || 1), end: Math.min(start, b.length || 1), kind: "deleted" });
  }
  return changes;
}

export interface GutterDecoration {
  range: { startLineNumber: number; startColumn: number; endLineNumber: number; endColumn: number };
  options: { isWholeLine: true; linesDecorationsClassName: string };
}

/** Converts changes to Monaco decoration descriptors (CSS classes live in index.css). */
export function toGutterDecorations(changes: LineChange[]): GutterDecoration[] {
  return changes.map((c) => ({
    range: { startLineNumber: c.start, startColumn: 1, endLineNumber: c.end, endColumn: 1 },
    options: { isWholeLine: true, linesDecorationsClassName: `git-gutter git-gutter-${c.kind}` },
  }));
}
