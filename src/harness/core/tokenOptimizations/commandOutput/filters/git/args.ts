// ============================================================
// filters/git/args.ts -- reading a git command line: which subcommand
// runs past git's own options (`git -C repo --no-pager log`), and whether
// it asked for an output shape a filter must leave alone.
// ============================================================

import { hasFlag, subcommand } from "../../invocation";
import type { Invocation } from "../../types";

const GLOBAL_VALUE_FLAGS = ["-C", "-c", "--git-dir", "--work-tree", "--namespace", "--exec-path", "--config-env"];

export function gitSubcommand(command: Invocation): string | undefined {
  return command.tool === "git" ? subcommand(command, GLOBAL_VALUE_FLAGS) : undefined;
}

export const isGit = (command: Invocation, ...subcommands: string[]): boolean => {
  const sub = gitSubcommand(command);
  return sub !== undefined && subcommands.includes(sub);
};

/** Flags that make git print something other than a unified diff. */
const NON_PATCH_FLAGS = [
  "--stat", "--shortstat", "--numstat", "--name-only", "--name-status", "--raw", "--summary", "--check",
  "--color-words", "-s", "--no-patch", "--dirstat", "--compact-summary", "--binary", "--quiet", "--exit-code",
];

export function asksForNonPatchShape(command: Invocation): boolean {
  if (hasFlag(command, ...NON_PATCH_FLAGS)) return true;
  return command.args.some((arg) => arg === "--word-diff" || (arg.startsWith("--word-diff=") && arg !== "--word-diff=none"));
}
