// ============================================================
// recall/read.ts -- reading a stored output back: whole, by line range
// or by a regular expression, always with line numbers and in bounded
// pieces, so a 20,000-line log is searched rather than reloaded.
// ============================================================

import type { RecallEntry } from "./store";

export const READ_LIMITS = {
  /** Lines one read returns at most. */
  maxReadLines: 400,
  /** Matching lines one search returns at most. */
  maxMatches: 200,
} as const;

export interface RecallQuery {
  /** Regular expression (case-insensitive); only matching lines are returned, with their numbers. */
  pattern?: string;
  /** 1-based, inclusive. */
  startLine?: number;
  endLine?: number;
}

export type Recalled = { ok: true; text: string } | { ok: false; error: string };

const numbered = (lines: readonly string[], from: number): string[] => lines.map((line, i) => `${from + i}: ${line}`);

function range(entry: RecallEntry, lines: readonly string[], query: RecallQuery): Recalled {
  const start = Math.max(1, Math.floor(query.startLine ?? 1));
  const asked = Math.min(lines.length, Math.floor(query.endLine ?? lines.length));
  const end = Math.min(asked, start + READ_LIMITS.maxReadLines - 1);
  if (start > lines.length) return { ok: false, error: `${entry.id} has ${lines.length} lines; start_line ${start} is past the end.` };
  const head = `${entry.id} (${entry.label}): lines ${start}-${end} of ${lines.length}.`;
  const more = end < lines.length ? `\n[more: job_output id="${entry.id}" start_line=${end + 1}, or pattern to search]` : "";
  return { ok: true, text: `${head}\n${numbered(lines.slice(start - 1, end), start).join("\n")}${more}` };
}

function compile(pattern: string): RegExp {
  try {
    return new RegExp(pattern, "i");
  } catch {
    return new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
  }
}

function search(entry: RecallEntry, lines: readonly string[], query: RecallQuery): Recalled {
  const pattern = compile(query.pattern!);
  const from = Math.max(1, Math.floor(query.startLine ?? 1));
  const to = Math.min(lines.length, Math.floor(query.endLine ?? lines.length));
  const hits: string[] = [];
  let total = 0;
  for (let n = from; n <= to; n += 1) {
    if (!pattern.test(lines[n - 1])) continue;
    total += 1;
    if (hits.length < READ_LIMITS.maxMatches) hits.push(`${n}: ${lines[n - 1]}`);
  }
  if (total === 0) return { ok: true, text: `${entry.id} (${entry.label}): no line of ${lines.length} matches /${query.pattern}/.` };
  const more = total > hits.length ? `\n[${total - hits.length} more matches: narrow the pattern or give start_line]` : "";
  return { ok: true, text: `${entry.id} (${entry.label}): ${total} of ${lines.length} lines match /${query.pattern}/.\n${hits.join("\n")}${more}` };
}

export function readEntry(entry: RecallEntry, query: RecallQuery = {}): Recalled {
  const lines = entry.text.split("\n");
  return query.pattern !== undefined && query.pattern !== "" ? search(entry, lines, query) : range(entry, lines, query);
}
