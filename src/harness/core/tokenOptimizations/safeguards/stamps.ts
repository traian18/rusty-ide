// ============================================================
// safeguards/stamps.ts -- every lossy pass marks what it did with one
// line, a stamp, so a later pass knows the text is no longer the original
// and does not condense it again (losses would compound without either
// pass knowing). The stamp also carries the way back to the original.
//
//   [rusty:condensed git-log · 18,294->4,960 chars · full output: job_output id="out-3f9c2a81d4e70b5a"]
//
// The grammar is shared with rusty-core: harness-context keeps `[rusty:`
// stamp lines when it elides an old tool result, so the recall id
// survives in-run compaction too. Change both sides together.
// ============================================================

export const STAMP_PREFIX = "[rusty:";

export interface Stamp {
  /** What was done, such as "condensed". */
  action: string;
  /** Which pass did it, such as "git-log". */
  method: string;
  rawChars: number;
  shownChars: number;
  /** Where the original can be read back; absent when it was not kept. */
  recallId?: string;
}

const STAMP_LINE = /^\[rusty:([a-z]+) ([a-z0-9-]+) · ([\d,]+)->([\d,]+) chars(?: · full output: job_output id="(out-[0-9a-f]+)"[^\]\n]*)?\]$/gm;

const chars = (count: number) => count.toLocaleString("en-US");

/** A method name in stamp form: lower case, spaces as dashes. */
export const stampMethod = (name: string): string => name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "generic";

export function renderStamp(stamp: Stamp): string {
  const recall = stamp.recallId ? ` · full output: job_output id="${stamp.recallId}" (add pattern, or start_line and end_line, to read part)` : "";
  return `${STAMP_PREFIX}${stamp.action} ${stampMethod(stamp.method)} · ${chars(stamp.rawChars)}->${chars(stamp.shownChars)} chars${recall}]`;
}

export function parseStamps(text: string): Stamp[] {
  return [...text.matchAll(STAMP_LINE)].map((m) => ({
    action: m[1],
    method: m[2],
    rawChars: Number(m[3].replace(/,/g, "")),
    shownChars: Number(m[4].replace(/,/g, "")),
    ...(m[5] ? { recallId: m[5] } : {}),
  }));
}

/** Whether a lossy pass already ran over `text`. */
export const hasStamp = (text: string): boolean => parseStamps(text).length > 0;
