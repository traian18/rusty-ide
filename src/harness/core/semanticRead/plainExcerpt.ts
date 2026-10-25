import { readLineRange } from "./lineRange";

/** How many lines a read without the Smart Read selector returns at most. */
export const PLAIN_EXCERPT_LINES = 300;
/** Lines kept around each line that names a word of the request. */
const CONTEXT_LINES = 8;

/** Words of a request that say nothing about where in a file to look. */
const COMMON_WORDS = new Set([
  "about", "also", "and", "are", "around", "between", "code", "current", "does", "each", "every", "file", "find",
  "focusing", "from", "function", "functions", "have", "how", "implementation", "include", "including", "into",
  "line", "lines", "need", "needed", "read", "relevant", "show", "that", "their", "them", "there", "these", "this",
  "those", "what", "when", "where", "which", "while", "with", "without",
]);

/** The identifiers and longer words of a request, the words a file's lines would contain. */
export function requestTerms(request: string): string[] {
  const words = request.match(/[A-Za-z_$][A-Za-z0-9_$]{3,}/g) ?? [];
  return [...new Set(words.filter((word) => !COMMON_WORDS.has(word.toLowerCase())))];
}

function mentions(line: string, terms: readonly string[]): boolean {
  const lower = line.toLowerCase();
  return terms.some((term) => lower.includes(term.toLowerCase()));
}

/**
 * A long file without the Smart Read selector: the parts around the lines that
 * name a word of `request`, at most PLAIN_EXCERPT_LINES lines, or the file's
 * first lines when the request names nothing in it (or there is no request).
 */
export function plainExcerpt(path: string, content: string, request: string): string {
  const lines = content.split(/\r?\n/);
  const terms = requestTerms(request);
  const hits = terms.length === 0 ? [] : lines.flatMap((line, index) => (mentions(line, terms) ? [index] : []));
  if (hits.length === 0) return readLineRange(path, content, { startLine: 1, endLine: PLAIN_EXCERPT_LINES });

  const windows: Array<[number, number]> = [];
  let budget = PLAIN_EXCERPT_LINES;
  for (const hit of hits) {
    const start = Math.max(0, hit - CONTEXT_LINES);
    const end = Math.min(lines.length - 1, hit + CONTEXT_LINES);
    const last = windows[windows.length - 1];
    if (last && start <= last[1] + 1) {
      const grown = Math.min(end, last[1] + budget);
      budget -= grown - last[1];
      last[1] = grown;
    } else {
      const fitted = Math.min(end, start + budget - 1);
      if (fitted < start) break;
      windows.push([start, fitted]);
      budget -= fitted - start + 1;
    }
    if (budget <= 0) break;
  }
  const parts = windows.map(([start, end]) => `[lines ${start + 1}-${end + 1}]\n${lines.slice(start, end + 1).join("\n")}`);
  return [`File: ${path} (${lines.length} lines)`, `[The parts that mention ${terms.slice(0, 8).join(", ")}]`, ...parts].join("\n");
}
