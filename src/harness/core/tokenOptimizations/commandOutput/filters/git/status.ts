// ============================================================
// filters/git/status.ts -- `git status` in its long format: git's own
// "(use "git add <file>..." to ...)" advice and blank lines go, the
// branch line, section headers and every file stay, a very long section
// is capped. Short and porcelain formats are already compact.
// ============================================================

import { hasFlag } from "../../invocation";
import { joinLines, plural } from "../../text";
import type { CommandFilter } from "../../types";
import { isGit } from "./args";

const MAX_ENTRIES_PER_SECTION = 40;

/** git's advice lines, indented by two spaces and wrapped in parentheses. */
const ADVICE = /^ {2}\(.*\)$/;
/** A closing line with advice in parentheses at its end. */
const TRAILING_ADVICE = /^((?:no changes added to commit|nothing added to commit but untracked files present|nothing to commit)[^(]*?)\s*\(use .*\)$/;

export const gitStatusFilter: CommandFilter = {
  name: "git status",
  matches: (command) => isGit(command, "status") && !hasFlag(command, "--porcelain", "-s", "--short", "-z", "-v", "--verbose"),
  apply: (output) => {
    const out: string[] = [];
    let inSection = 0;
    let hidden = 0;
    const flushHidden = () => {
      if (hidden > 0) out.push(`\t... ${plural(hidden, "more file")}`);
      hidden = 0;
    };
    for (const line of output.split("\n")) {
      // Section headers end in ":", so the blank lines between sections carry nothing.
      if (ADVICE.test(line) || line.trim() === "") continue;
      if (line.startsWith("\t")) {
        inSection += 1;
        if (inSection > MAX_ENTRIES_PER_SECTION) hidden += 1;
        else out.push(line);
        continue;
      }
      flushHidden();
      inSection = 0;
      const trailing = TRAILING_ADVICE.exec(line);
      out.push(trailing ? trailing[1] : line);
    }
    flushHidden();
    return joinLines(out);
  },
};
