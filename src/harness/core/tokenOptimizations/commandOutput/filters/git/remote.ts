// ============================================================
// filters/git/remote.ts -- git commands that change something (push,
// pull, fetch, clone, commit, merge, rebase, checkout...): the object
// counting and transfer progress goes, long create/delete-mode and
// diffstat lists are capped; ref updates, conflicts, errors and hints stay.
// ============================================================

import { capList, plural } from "../../text";
import type { CommandFilter } from "../../types";
import { isGit } from "./args";

const CHANGING = [
  "push", "pull", "fetch", "clone", "commit", "merge", "rebase", "checkout", "switch", "stash", "cherry-pick",
  "revert", "am", "submodule", "lfs", "gc", "reset", "restore", "add", "rm", "mv", "tag", "worktree",
];
const MAX_MODE_LINES = 10;
const MAX_DIFFSTAT_LINES = 30;

const PROGRESS = [
  /^(remote: )?(Enumerating|Counting|Compressing|Writing|Receiving|Resolving|Unpacking|Finding sources|Updating files|Checking out files|Filtering content|Updating index)\b.*(\d+%|done\.?|\(\d+\/\d+\))/,
  /^(remote: )?Total \d+ \(delta \d+\)/,
  /^remote:\s*$/,
  /^Delta compression using up to \d+ threads/,
];
const MODE_LINE = /^ (create|delete) mode \d{6} |^ rename .* \(\d+%\)$|^ mode change \d{6} => \d{6} /;
const DIFFSTAT_LINE = /^ \S.* \| +(\d+|Bin\b)/;

/** Caps each run of consecutive lines matching `pattern`. */
function capRuns(lines: readonly string[], pattern: RegExp, max: number, more: (hidden: number) => string): string[] {
  const out: string[] = [];
  let run: string[] = [];
  const flush = () => {
    out.push(...capList(run, max, more));
    run = [];
  };
  for (const line of lines) {
    if (pattern.test(line)) run.push(line);
    else {
      flush();
      out.push(line);
    }
  }
  flush();
  return out;
}

export const gitRemoteFilter: CommandFilter = {
  name: "git",
  matches: (command) => isGit(command, ...CHANGING),
  apply: (output) => {
    const lines = output.split("\n").filter((line) => !PROGRESS.some((pattern) => pattern.test(line)));
    const modes = capRuns(lines, MODE_LINE, MAX_MODE_LINES, (hidden) => ` ... ${plural(hidden, "more file")} created, deleted or renamed`);
    return capRuns(modes, DIFFSTAT_LINE, MAX_DIFFSTAT_LINES, (hidden) => ` ... ${plural(hidden, "more file")} changed`).join("\n");
  },
};
