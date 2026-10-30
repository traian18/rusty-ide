// ============================================================
// filters/infra/gh.ts -- the GitHub CLI (`gh pr diff` is the diff
// filter's):
//   pr/issue/release/repo view   markdown bodies without HTML comments
//                                (PR templates), badge and image lines
//   run view --log / --log-failed  the per-line timestamp and the
//                                ##[group] markers go
// --json, --jq, --template and --web calls already chose their output.
// ============================================================

import { hasFlag, subcommand } from "../../invocation";
import type { CommandFilter } from "../../types";

const IMAGE_ONLY_LINE = /^\s*((\[!\[[^\]]*\]\([^)]*\)\]\([^)]*\)|!\[[^\]]*\]\([^)]*\)|<img\b[^>]*>)\s*)+$/;

export function slimMarkdown(text: string): string {
  return text
    .replace(/<!--[\s\S]*?-->/g, "")
    .split("\n")
    .filter((line) => !IMAGE_ONLY_LINE.test(line))
    .join("\n");
}

/** `job\tstep\t2026-10-30T12:00:00.1234567Z message` without the timestamp. */
export const stripLogTimestamps = (text: string): string =>
  text
    .split("\n")
    .map((line) => line.replace(/\t\d{4}-\d\d-\d\dT[\d:.]+Z ?/, "\t"))
    .filter((line) => !/\t##\[(end)?group\]/.test(line) || /##\[group\]Run /.test(line))
    .join("\n");

export const ghFilter: CommandFilter = {
  name: "gh",
  matches: (command) => command.tool === "gh" && !hasFlag(command, "--json", "--jq", "-q", "--template", "-t", "--web", "-w"),
  apply: (output, command) => {
    const group = subcommand(command);
    const verb = command.args[command.args.indexOf(group ?? "") + 1];
    if (group === "run" && verb === "view" && hasFlag(command, "--log", "--log-failed")) return stripLogTimestamps(output);
    if (["pr", "issue", "release", "repo"].includes(group ?? "") && verb === "view") return slimMarkdown(output);
    return undefined;
  },
};
