// ============================================================
// filters/files/grep.ts -- grep, rg, ag and git grep matches. Matches
// written `path:line:content` (or `path:content`, rg's piped default)
// are grouped by file: the path once, then `line: content` per match.
// Content keeps its indentation (it means something in Python or YAML)
// and is only clipped when very long (minified files). Per-file and total
// caps apply. Context output (-A/-B/-C) and counts (-c) are not regrouped,
// only clipped; path-only output is the paths filter's.
// ============================================================

import { gitSubcommand } from "../git/args";
import { hasFlag } from "../../invocation";
import { clipLine, plural } from "../../text";
import type { CommandFilter, Invocation } from "../../types";

const MAX_CONTENT_CHARS = 300;
const MAX_MATCHES_PER_FILE = 30;
const MAX_FILES = 80;

const isSearch = (command: Invocation) => ["grep", "egrep", "fgrep", "rg", "ag", "ack"].includes(command.tool) || gitSubcommand(command) === "grep";

interface Match {
  path: string;
  line?: string;
  content: string;
}

const looksLikePath = (text: string) => text.length < 300 && !/^\s|\s$/.test(text) && /[/.]/.test(text) && !/^\d+$/.test(text);

/** Every line as a match, or undefined when any line is not one. */
function parseMatches(output: string): Match[] | undefined {
  const matches: Match[] = [];
  for (const line of output.split("\n")) {
    if (line === "") continue;
    const numbered = /^(.+?):(\d+):(.*)$/.exec(line);
    if (numbered && looksLikePath(numbered[1])) {
      matches.push({ path: numbered[1], line: numbered[2], content: numbered[3] });
      continue;
    }
    const plain = /^(.+?):(.*)$/.exec(line);
    if (!plain || !looksLikePath(plain[1])) return undefined;
    matches.push({ path: plain[1], content: plain[2] });
  }
  return matches;
}

/** Matches grouped by file, or undefined when they do not span several files. */
export function groupMatches(output: string): string | undefined {
  const matches = parseMatches(output);
  if (!matches || matches.length === 0) return undefined;
  const byFile = new Map<string, Match[]>();
  for (const match of matches) {
    if (!byFile.has(match.path)) byFile.set(match.path, []);
    byFile.get(match.path)!.push(match);
  }
  if (byFile.size < 2 && matches.every((match) => match.line === undefined)) return undefined;
  const out: string[] = [];
  let files = 0;
  for (const [path, list] of byFile) {
    if (files === MAX_FILES) {
      const rest = [...byFile.values()].slice(files).reduce((sum, l) => sum + l.length, 0);
      out.push(`... ${plural(byFile.size - files, "more file")} with ${plural(rest, "match", "matches")}`);
      break;
    }
    files += 1;
    out.push(list.length > MAX_MATCHES_PER_FILE ? `${path} (${list.length} matches)` : path);
    for (const match of list.slice(0, MAX_MATCHES_PER_FILE)) out.push(`  ${match.line !== undefined ? `${match.line}: ` : ""}${clipLine(match.content, MAX_CONTENT_CHARS)}`);
    if (list.length > MAX_MATCHES_PER_FILE) out.push(`  ... +${list.length - MAX_MATCHES_PER_FILE} more in this file`);
  }
  return out.join("\n");
}

const clipAll = (output: string) => output.split("\n").map((line) => clipLine(line, MAX_CONTENT_CHARS)).join("\n");

export const grepFilter: CommandFilter = {
  name: "search",
  matches: isSearch,
  apply: (output, command) => {
    if (hasFlag(command, "-c", "--count", "--count-matches", "-A", "-B", "-C", "--context", "--after-context", "--before-context", "--json", "--vimgrep")) return clipAll(output);
    if (command.args.some((arg) => /^-[ABC]\d+$/.test(arg))) return clipAll(output);
    return groupMatches(output) ?? clipAll(output);
  },
};
