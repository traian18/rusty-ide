// ============================================================
// commandOutput/generic.ts -- the layer every command gets, whether or
// not a specific filter matched:
//   before: strip ANSI codes, keep only the last frame of `\r` redraws
//   after:  collapse runs of identical adjacent lines, clip very long
//           lines, and window very long output (small head, large tail,
//           because errors are at the end)
// Each step is a pure function of its input. Limits live in LIMITS so they
// can be tuned in one place.
// ============================================================

import { clipLine } from "./text";

export const LIMITS = {
  /** Identical adjacent lines collapsed from this many on. */
  dedupMinRun: 3,
  /** Characters a single line may keep. */
  maxLineChars: 2000,
  /** Output longer than this many lines is windowed... */
  windowAboveLines: 300,
  /** ...to its first lines... */
  windowHead: 50,
  /** ...and its last lines. */
  windowTail: 200,
} as const;

const ANSI = /\u001b(?:\[[0-9;?]*[ -/]*[@-~]|\][^\u0007\u001b]*(?:\u0007|\u001b\\)|[@-Z\\-_])/g;

export const stripAnsi = (text: string): string => text.replace(ANSI, "");

/** Keeps the last non-empty `\r` segment of each line: what a terminal would show. */
export function collapseRedraws(text: string): string {
  if (!text.includes("\r")) return text;
  return text
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => (line.includes("\r") ? (line.split("\r").reverse().find((segment) => segment !== "") ?? "") : line))
    .join("\n");
}

/** What every command's output goes through first. */
export const normalize = (text: string): string => collapseRedraws(stripAnsi(text));

/** Runs of identical, non-blank adjacent lines become the line and `[xN]`. Order and counts are kept. */
export function dedupAdjacent(text: string): string {
  const lines = text.split("\n");
  const out: string[] = [];
  for (let i = 0; i < lines.length; ) {
    let run = 1;
    while (i + run < lines.length && lines[i + run] === lines[i]) run += 1;
    if (run >= LIMITS.dedupMinRun && lines[i].trim() !== "") out.push(lines[i], `[x${run}]`);
    else for (let k = 0; k < run; k += 1) out.push(lines[i]);
    i += run;
  }
  return out.join("\n");
}

export const clipLongLines = (text: string): string => text.split("\n").map((line) => clipLine(line, LIMITS.maxLineChars)).join("\n");

/** Keeps the head and the (larger) tail of a long output with a marker between them. */
export function windowLines(text: string): string {
  const lines = text.split("\n");
  if (lines.length <= LIMITS.windowAboveLines) return text;
  const hidden = lines.length - LIMITS.windowHead - LIMITS.windowTail;
  return [...lines.slice(0, LIMITS.windowHead), `[... ${hidden.toLocaleString("en-US")} lines omitted ...]`, ...lines.slice(-LIMITS.windowTail)].join("\n");
}

/** What every command's output goes through last. */
export const finish = (text: string): string => windowLines(clipLongLines(dedupAdjacent(text)));
