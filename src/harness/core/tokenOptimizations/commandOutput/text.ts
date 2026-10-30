// ============================================================
// commandOutput/text.ts -- line helpers every filter builds on: split and
// join that keep the trailing newline, dropping lines by pattern while
// counting them, capping a list with a "+N more" line, and formatting
// numbers for the summaries a filter writes in place of what it dropped.
// ============================================================

export const splitLines = (text: string): string[] => text.split("\n");

/** Joins lines back, collapsing the blank runs that dropping lines leaves behind. */
export function joinLines(lines: readonly string[]): string {
  const out: string[] = [];
  for (const line of lines) {
    if (line.trim() === "" && (out.length === 0 || out[out.length - 1].trim() === "")) continue;
    out.push(line);
  }
  while (out.length > 0 && out[out.length - 1].trim() === "") out.pop();
  return out.join("\n");
}

export const matchesAny = (line: string, patterns: readonly RegExp[]): boolean => patterns.some((pattern) => pattern.test(line));

/** `lines` without those matching `patterns`, and how many were dropped. */
export function dropMatching(lines: readonly string[], patterns: readonly RegExp[]): { kept: string[]; dropped: number } {
  const kept = lines.filter((line) => !matchesAny(line, patterns));
  return { kept, dropped: lines.length - kept.length };
}

/**
 * Replaces the lines matching `pattern` with one summary line at the place of
 * the first, such as "npm warn deprecated: 14 packages (details hidden)".
 * Unchanged when fewer than `min` match.
 */
export function collapseMatching(lines: readonly string[], pattern: RegExp, summary: (count: number) => string, min = 1): string[] {
  const count = lines.filter((line) => pattern.test(line)).length;
  if (count < min) return [...lines];
  const out: string[] = [];
  let placed = false;
  for (const line of lines) {
    if (!pattern.test(line)) out.push(line);
    else if (!placed) {
      out.push(summary(count));
      placed = true;
    }
  }
  return out;
}

/** The first `max` items, then a line saying how many more there were. */
export function capList<T>(items: readonly T[], max: number, more: (hidden: number) => T): T[] {
  return items.length <= max ? [...items] : [...items.slice(0, max), more(items.length - max)];
}

export const plural = (count: number, word: string, many = `${word}s`): string => `${count.toLocaleString("en-US")} ${count === 1 ? word : many}`;

/** Bytes as ls -h would print them: 512, 1.2K, 34M. */
export function humanSize(bytes: number): string {
  const units = ["", "K", "M", "G", "T"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return unit === 0 ? String(value) : `${value < 10 ? value.toFixed(1) : Math.round(value)}${units[unit]}`;
}

/** Cuts a line longer than `max` characters, saying how much was cut. */
export const clipLine = (line: string, max: number): string => (line.length > max ? `${line.slice(0, max)}… [+${(line.length - max).toLocaleString("en-US")} chars]` : line);
