// ============================================================
// filters/builds/cargo.ts -- cargo build, check, clippy, run, doc and
// friends. Cargo's status lines (Compiling, Checking, Downloaded...) are
// counted into one line each; errors stay whole; warnings stay whole up to
// a cap, and the rest are counted by their message ("12x unused import").
// `stripCargoStatus` is shared with the test filter, since `cargo test`
// compiles first.
// ============================================================

import { subcommand } from "../../invocation";
import { plural } from "../../text";
import type { CommandFilter } from "../../types";

const MAX_WARNING_BLOCKS = 15;
const COUNTED_STATUS = ["Compiling", "Checking", "Downloaded", "Documenting", "Fresh"] as const;
const DROPPED_STATUS = /^\s+(Downloading crates|Updating|Locking|Adding|Removing|Blocking waiting for file lock|Unpacking|Packaging|Verifying|Archiving|Fetching)\b/;

/** Counts cargo's per-crate status lines into one line per kind, in place of the first. */
export function stripCargoStatus(lines: readonly string[]): string[] {
  const counts = new Map<string, number>();
  const out: string[] = [];
  for (const line of lines) {
    if (DROPPED_STATUS.test(line)) continue;
    const status = /^\s+(\w+) \S+ v\d/.exec(line)?.[1];
    if (status && (COUNTED_STATUS as readonly string[]).includes(status)) {
      if (!counts.has(status)) out.push(`\u0000${status}`);
      counts.set(status, (counts.get(status) ?? 0) + 1);
      continue;
    }
    out.push(line);
  }
  return out.map((line) => {
    if (!line.startsWith("\u0000")) return line;
    const status = line.slice(1);
    return `   ${status} ${plural(counts.get(status)!, "crate")}`;
  });
}

interface Block {
  lines: string[];
  kind: "error" | "warning" | "other";
  message?: string;
}

/** Splits output into diagnostic blocks: a column-0 `error`/`warning` header up to the next blank line. */
function blocks(lines: readonly string[]): Block[] {
  const out: Block[] = [];
  let current: Block | undefined;
  for (const line of lines) {
    const header = /^(error|warning)(?:\[\w+\])?: (.+)$/.exec(line);
    if (header) {
      current = { lines: [line], kind: header[1] as "error" | "warning", message: header[2] };
      out.push(current);
      continue;
    }
    if (current && current.kind !== "other" && line.trim() !== "") {
      current.lines.push(line);
      continue;
    }
    current = { lines: [line], kind: "other" };
    out.push(current);
  }
  return out;
}

/** A cargo summary line such as "warning: `app` (lib) generated 12 warnings". */
const isSummary = (block: Block) => /generated \d+ warnings?|could not compile|aborting due to/.test(block.message ?? "");

/** Keeps every error and the first warnings whole; counts the remaining warnings by message. */
export function capWarnings(lines: readonly string[]): string[] {
  const out: string[] = [];
  const hidden = new Map<string, number>();
  let shown = 0;
  for (const block of blocks(lines)) {
    if (block.kind !== "warning" || isSummary(block)) {
      out.push(...block.lines);
      continue;
    }
    if (shown < MAX_WARNING_BLOCKS) {
      shown += 1;
      out.push(...block.lines);
      continue;
    }
    hidden.set(block.message!, (hidden.get(block.message!) ?? 0) + 1);
  }
  if (hidden.size > 0) {
    const total = [...hidden.values()].reduce((sum, n) => sum + n, 0);
    const kinds = [...hidden.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([message, n]) => `${n}x ${message}`);
    out.push(`... ${plural(total, "more warning")} not shown: ${kinds.join("; ")}`);
  }
  return out;
}

const BUILD_SUBCOMMANDS = ["build", "b", "check", "c", "clippy", "run", "r", "doc", "d", "install", "fetch", "update", "bench", "fix", "publish", "package", "tree"];

export const cargoBuildFilter: CommandFilter = {
  name: "cargo",
  matches: (command) => command.tool === "cargo" && BUILD_SUBCOMMANDS.includes(subcommand(command) ?? ""),
  apply: (output) => capWarnings(stripCargoStatus(output.split("\n"))).join("\n"),
};
