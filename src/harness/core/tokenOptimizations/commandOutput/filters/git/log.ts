// ============================================================
// filters/git/log.ts -- `git log` in its default format becomes one line
// per commit: short hash, refs, date, author and subject, plus how many
// body lines the commit has (the full text is one recall away). Any other
// format the model asked for (--oneline, --format, -p, --stat, --graph)
// is left as it is, and so is output this parser does not recognise.
// ============================================================

import { hasFlag } from "../../invocation";
import { capList, plural } from "../../text";
import type { CommandFilter } from "../../types";
import { isGit } from "./args";

const MAX_COMMITS = 60;
const SHAPED_BY_THE_MODEL = [
  "--format", "--pretty", "--oneline", "-p", "-u", "--patch", "--stat", "--shortstat", "--numstat", "--name-only",
  "--name-status", "--raw", "--graph", "-L", "--summary", "--dirstat", "--cc", "-m", "--show-signature", "--notes",
];

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** git's default date ("Fri Oct 30 17:31:56 2026 +0200") or an ISO one, as YYYY-MM-DD. */
export function shortDate(date: string): string {
  const iso = /^(\d{4}-\d\d-\d\d)/.exec(date);
  if (iso) return iso[1];
  const m = /^\w{3} (\w{3}) +(\d{1,2}) [\d:]+ (\d{4})/.exec(date);
  const month = m ? MONTHS.indexOf(m[1]) + 1 : 0;
  return m && month > 0 ? `${m[3]}-${String(month).padStart(2, "0")}-${m[2].padStart(2, "0")}` : date;
}

interface Commit {
  hash: string;
  refs?: string;
  author: string;
  date: string;
  merge: boolean;
  message: string[];
}

/** The commits of default-format log output, or undefined when it is in another shape. */
function parseCommits(output: string): Commit[] | undefined {
  const lines = output.split("\n");
  const commits: Commit[] = [];
  let current: Commit | undefined;
  let inMessage = false;
  for (const line of lines) {
    const head = /^commit ([0-9a-f]{7,64})(?: \((.+)\))?$/.exec(line);
    if (head) {
      current = { hash: head[1].slice(0, 7), refs: head[2], author: "", date: "", merge: false, message: [] };
      commits.push(current);
      inMessage = false;
      continue;
    }
    if (!current) {
      if (line.trim() === "") continue;
      return undefined;
    }
    if (!inMessage) {
      const field = /^(\w+):\s+(.*)$/.exec(line);
      if (field) {
        if (field[1] === "Author") current.author = field[2].replace(/\s*<[^>]*>$/, "");
        else if (field[1] === "Date" || field[1] === "AuthorDate") current.date = shortDate(field[2]);
        else if (field[1] === "Merge") current.merge = true;
        continue;
      }
      if (line.trim() === "") {
        inMessage = true;
        continue;
      }
      return undefined;
    }
    if (line.startsWith("    ") || line.trim() === "") current.message.push(line.slice(4));
    else return undefined;
  }
  return commits.length > 0 ? commits : undefined;
}

function oneLine(commit: Commit): string {
  const text = commit.message.map((line) => line.trim());
  while (text.length > 0 && text[text.length - 1] === "") text.pop();
  const subject = text[0] ?? "";
  const body = text.slice(1).filter((line) => line !== "").length;
  const refs = commit.refs ? ` (${commit.refs})` : "";
  const merge = commit.merge ? " (merge)" : "";
  const more = body > 0 ? ` (+${plural(body, "body line")})` : "";
  return `${commit.hash}${refs} ${commit.date} [${commit.author}]${merge} ${subject}${more}`;
}

export const gitLogFilter: CommandFilter = {
  name: "git log",
  matches: (command) => isGit(command, "log") && !hasFlag(command, ...SHAPED_BY_THE_MODEL),
  apply: (output) => {
    const commits = parseCommits(output);
    if (!commits) return undefined;
    return capList(commits.map(oneLine), MAX_COMMITS, (hidden) => `... ${plural(hidden, "more commit")}`).join("\n");
  },
};
