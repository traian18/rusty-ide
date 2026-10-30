// ============================================================
// filters/files/paths.ts -- commands that print one path per line: find,
// fd, `rg --files`, `grep -l`, `git ls-files`. A long list is grouped by
// directory, so each directory is written once followed by its entries'
// names, with a cap per directory and on the number of directories.
// find actions that print something else (-exec, -ls, -printf, -print0)
// are left alone.
// ============================================================

import { gitSubcommand } from "../git/args";
import { hasFlag } from "../../invocation";
import { plural } from "../../text";
import type { CommandFilter, Invocation } from "../../types";

const GROUP_FROM_LINES = 40;
const MAX_NAMES_PER_DIRECTORY = 50;
const MAX_DIRECTORIES = 150;

function printsPaths(command: Invocation): boolean {
  if (command.tool === "find") return !hasFlag(command, "-exec", "-execdir", "-ls", "-printf", "-fprintf", "-print0", "-delete", "-ok");
  if (command.tool === "fd" || command.tool === "fdfind") return !hasFlag(command, "-x", "--exec", "-X", "--exec-batch", "-l", "--list-details", "-0");
  if (command.tool === "rg") return hasFlag(command, "--files", "-l", "--files-with-matches", "--files-without-match");
  if (command.tool === "grep") return hasFlag(command, "-l", "--files-with-matches", "-L", "--files-without-match");
  return gitSubcommand(command) === "ls-files" && !hasFlag(command, "-s", "--stage", "-z", "--debug");
}

/** Paths grouped by their directory, in the order the directories first appear. */
export function groupPaths(output: string): string | undefined {
  const paths = output.split("\n").filter((line) => line.trim() !== "");
  if (paths.length < GROUP_FROM_LINES) return undefined;
  const groups = new Map<string, string[]>();
  for (const path of paths) {
    const slash = path.lastIndexOf("/");
    const directory = slash < 0 ? "." : path.slice(0, slash + 1);
    const name = slash < 0 ? path : path.slice(slash + 1);
    if (!groups.has(directory)) groups.set(directory, []);
    groups.get(directory)!.push(name);
  }
  const out: string[] = [];
  let shown = 0;
  for (const [directory, names] of groups) {
    if (shown === MAX_DIRECTORIES) {
      const rest = [...groups.values()].slice(shown).reduce((sum, list) => sum + list.length, 0);
      out.push(`... ${plural(groups.size - shown, "more directory", "more directories")} (${plural(rest, "path")})`);
      break;
    }
    shown += 1;
    const listed = names.slice(0, MAX_NAMES_PER_DIRECTORY).join("  ");
    const more = names.length > MAX_NAMES_PER_DIRECTORY ? `  ... +${names.length - MAX_NAMES_PER_DIRECTORY} more` : "";
    out.push(`${directory} (${names.length})`, `  ${listed}${more}`);
  }
  return `${plural(paths.length, "path")} in ${plural(groups.size, "directory", "directories")}:\n${out.join("\n")}`;
}

export const pathListFilter: CommandFilter = {
  name: "paths",
  matches: printsPaths,
  apply: (output) => groupPaths(output),
};
