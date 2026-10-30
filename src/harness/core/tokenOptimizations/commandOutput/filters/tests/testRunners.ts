// ============================================================
// filters/tests/testRunners.ts -- test runs: passing tests go, failures
// stay whole. Like checkOutput.ts it reads the output's format, not the
// command, so `npm test` hiding vitest is handled like `vitest`. What goes:
//   cargo   `test x ... ok|ignored`, empty test binaries (running 0 tests)
//   vitest  `✓ file (n tests)` pass lines and skipped `↓` lines
//   jest    `PASS file` and `✓ name (3 ms)` lines
//   pytest  `PASSED` lines of -v, progress rows with only passes and skips
//   go      `=== RUN/PAUSE/CONT`, `--- PASS`, bare `PASS`
//   dotnet  `Passed name [1 ms]` lines
// Summaries, failure details, panics, assertion diffs and tallies all stay.
// A run asked to show test output (--nocapture, -s) keeps it.
// ============================================================

import { hasFlag, packageScript, subcommand } from "../../invocation";
import { matchesAny } from "../../text";
import type { CommandFilter, Invocation } from "../../types";
import { capWarnings, stripCargoStatus } from "../builds/cargo";

const PASSING = [
  /^test .+ \.\.\. (ok|ignored)(, .*)?$/,
  /^\s*✓ /,
  /^\s*↓ /,
  /^PASS\s+\S/,
  /::\S+ PASSED(\s+\[\s*\d+%\])?$/,
  /^\S+\.py [.s]+\s+\[\s*\d+%\]$/,
  /^=== (RUN|PAUSE|CONT|NAME)\s/,
  /^\s*--- PASS: /,
  /^PASS$/,
  /^\s+Passed \S.*\[[\d.]+ ?m?s\]$/,
];

const TEST_TOOLS = ["pytest", "vitest", "jest", "mocha", "ava", "tap", "playwright", "nextest"];

export function isTestRun(command: Invocation): boolean {
  if (TEST_TOOLS.includes(command.tool)) return true;
  const sub = subcommand(command);
  if (command.tool === "cargo") return sub === "test" || sub === "t" || sub === "nextest";
  if (command.tool === "go" || command.tool === "dotnet") return sub === "test";
  if (command.tool === "bun" && sub === "test") return true;
  return /^test(:|$)/.test(packageScript(command) ?? "");
}

/** The model asked to see what the tests print. */
const showsTestOutput = (command: Invocation) => hasFlag(command, "--nocapture", "--show-output", "-s", "--capture=no", "--verbose", "-v", "-vv");

/** Drops `Running x` + `running 0 tests` + its `test result` line: binaries with nothing to run. */
function dropEmptyCargoBinaries(lines: readonly string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    const header = /^\s+(Running|Doc-tests) /.test(lines[i]);
    let j = header ? i + 1 : i;
    while (j < lines.length && lines[j].trim() === "") j += 1;
    if (lines[j] === "running 0 tests") {
      let k = j + 1;
      while (k < lines.length && !lines[k].startsWith("test result:")) k += 1;
      if (k < lines.length) {
        i = k;
        continue;
      }
    }
    out.push(lines[i]);
  }
  return out;
}

export function dropPassingTests(output: string, command: Invocation): string {
  let lines = output.split("\n");
  if (command.tool === "cargo") lines = capWarnings(dropEmptyCargoBinaries(stripCargoStatus(lines)));
  if (showsTestOutput(command) && command.tool === "cargo") return lines.join("\n");
  return lines.filter((line) => !matchesAny(line, PASSING)).join("\n");
}

export const testRunFilter: CommandFilter = {
  name: "tests",
  matches: isTestRun,
  apply: dropPassingTests,
};
