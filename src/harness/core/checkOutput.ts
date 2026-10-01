// ============================================================
// checkOutput.ts -- what a check's raw output means. `run_command` hands a
// model a blob of text with the exit code tacked on the end; this turns the
// output of a typecheck, lint, test or build into the things a model needs to
// act: which errors are where, how many tests failed, and whether the failure
// is about the code at all (a missing tool or uninstalled dependencies fail
// every check, and editing code never fixes that).
//
// Pure and format-based: the parsers look at the output, not at which command
// produced it, so `npm run typecheck` (which hides `tsc`) works the same as
// calling `tsc`. Built against real output from tsc, cargo (check and test),
// vitest, pytest and ruff; eslint, go, mypy, maven, kotlin and msbuild follow
// their documented formats.
// ============================================================

export type Severity = "error" | "warning";

export interface Issue {
  severity: Severity;
  message: string;
  file?: string;
  line?: number;
  column?: number;
  code?: string;
}

export interface ParsedOutput {
  issues: Issue[];
  /** The tool's own tally, such as "2 failed, 1 passed". */
  summary?: string;
  /** How many tests ran. Zero only when the output says nothing matched
   * (cargo's "0 passed", pytest's "no tests ran", go's "no tests to run", a
   * runner that skipped everything), never because the output was silent or
   * the run broke before any test started: those leave it undefined. */
  testsRun?: number;
}

/** Why a check did not pass. */
export type FailureKind =
  | "code"
  | "timeout"
  | "cancelled"
  | "dependencies"
  | "missing-tool"
  | "missing-script"
  | "missing-manifest"
  /** A test filter matched nothing, so nothing was checked. */
  | "no-match";

export interface Failure {
  kind: FailureKind;
  /** What to do next. */
  hint: string;
}

const ANSI = /\u001b\[[0-9;?]*[ -/]*[@-~]/g;
export const stripAnsi = (text: string): string => text.replace(ANSI, "");

const MAX_MESSAGE_CHARS = 300;
const clip = (text: string) => (text.length > MAX_MESSAGE_CHARS ? `${text.slice(0, MAX_MESSAGE_CHARS - 1)}…` : text);

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

/** The number in front of `word` in a tally such as "2 failed, 1 passed", else 0. */
const count = (tally: string, word: string): number => Number(new RegExp(`(\\d+) ${word}\\b`).exec(tally)?.[1] ?? 0);

export function parseCheckOutput(raw: string): ParsedOutput {
  const lines = stripAnsi(raw).split(/\r?\n/);
  const issues: Issue[] = [];
  const summaries: string[] = [];
  const add = (issue: Issue) => issues.push({ ...issue, message: clip(issue.message.replace(/\s+/g, " ").trim()) });

  // cargo test
  const cargoCounts = { passed: 0, failed: 0, seen: false };
  const failedTests: string[] = [];
  const panickedTests = new Set<string>();
  // eslint (stylish): a file name, then its problems
  let eslintFile: string | undefined;
  // pytest
  const pytestLocations: { file: string; line: number; used: boolean }[] = [];
  const pytestFailures: Issue[] = [];
  const collectionMessages = new Map<string, string>();
  let collecting: string | undefined;
  // go
  let goFailedPackages = 0;
  let goOkPackages = 0;
  let goRanPackages = 0;
  let goNoTestPackages = 0;
  // vitest and jest
  let jsRan = 0;
  let jsNone = false;
  // pytest
  let pytestRan = 0;
  let pytestSummary = false;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    let m: RegExpExecArray | null;

    // tsc and msbuild: file(line,col): error CODE: message
    if ((m = /^(.+?)\((\d+),(\d+)\): (error|warning) ([A-Za-z]+\d+): (.+)$/.exec(line))) {
      add({ severity: m[4] as Severity, file: m[1], line: Number(m[2]), column: Number(m[3]), code: m[5], message: m[6].replace(/\s+\[[^\]]*\.(?:cs|vb|fs)proj\]$/, "") });
      continue;
    }
    // tsc --pretty: file:line:col - error CODE: message
    if ((m = /^(.+?):(\d+):(\d+) - (error|warning) ([A-Za-z]+\d+): (.+)$/.exec(line))) {
      add({ severity: m[4] as Severity, file: m[1], line: Number(m[2]), column: Number(m[3]), code: m[5], message: m[6] });
      continue;
    }
    // rustc / cargo, and newer ruff: a header line, then `--> file:line:col`
    if ((m = /^\s*--> (.+?):(\d+):(\d+)\s*$/.exec(line))) {
      let header: RegExpExecArray | null = null;
      let ruff: RegExpExecArray | null = null;
      for (let back = i - 1; back >= Math.max(0, i - 3); back -= 1) {
        if (!lines[back].trim()) continue;
        header = /^(error|warning)(?:\[(\w+)\])?: (.+)$/.exec(lines[back]);
        if (!header) ruff = /^([A-Z]{1,4}\d{2,4})\b\s*(?:\[\*\]\s*)?(.*)$/.exec(lines[back]);
        break;
      }
      if (header) add({ severity: header[1] as Severity, code: header[2], message: header[3], file: m[1], line: Number(m[2]), column: Number(m[3]) });
      else if (ruff) add({ severity: "error", code: ruff[1], message: ruff[2], file: m[1], line: Number(m[2]), column: Number(m[3]) });
      continue;
    }
    // cargo test: a panic, with its location and message. The older format
    // (`panicked at 'msg', file:l:c`) has to be tried first: the newer pattern
    // would otherwise read the quoted message as part of the file name.
    if ((m = /^thread '(.+?)'(?: \(\d+\))? panicked at '(.*)', (.+?):(\d+):(\d+)$/.exec(line))) {
      panickedTests.add(m[1]);
      add({ severity: "error", file: m[3], line: Number(m[4]), column: Number(m[5]), message: `${m[1]}: ${m[2]}` });
      continue;
    }
    if ((m = /^thread '(.+?)'(?: \(\d+\))? panicked at (.+?):(\d+):(\d+):?$/.exec(line))) {
      const body: string[] = [];
      // The message runs until a blank line or cargo's backtrace hint.
      for (let j = i + 1; j < lines.length && lines[j].trim() !== "" && !/^note: /.test(lines[j]) && body.length < 3; j += 1) body.push(lines[j].trim());
      panickedTests.add(m[1]);
      add({ severity: "error", file: m[2], line: Number(m[3]), column: Number(m[4]), message: `${m[1]}: ${body.join(" | ")}` });
      continue;
    }
    if ((m = /^test (.+?) \.\.\. FAILED$/.exec(line))) {
      failedTests.push(m[1]);
      continue;
    }
    if ((m = /^test result: (?:ok|FAILED)\. (\d+) passed; (\d+) failed;/.exec(line))) {
      cargoCounts.seen = true;
      cargoCounts.passed += Number(m[1]);
      cargoCounts.failed += Number(m[2]);
      continue;
    }
    // vitest: ` FAIL  file > suite > test`, then the error and a `❯ file:line:col` frame
    if ((m = /^\s*FAIL\s+(\S+)\s+>\s+(.+)$/.exec(line))) {
      let message: string | undefined;
      let frame: RegExpExecArray | null = null;
      for (let j = i + 1; j < lines.length && j <= i + 30; j += 1) {
        if (/^\s*FAIL\s/.test(lines[j]) || /^⎯+/.test(lines[j])) break;
        if (message === undefined && lines[j].trim()) message = lines[j].trim();
        if (!frame) frame = /^\s*❯ (\S+?):(\d+):(\d+)\s*$/.exec(lines[j]);
      }
      add({ severity: "error", file: frame?.[1] ?? m[1], line: frame ? Number(frame[2]) : undefined, column: frame ? Number(frame[3]) : undefined, message: `${m[2]}: ${message ?? "failed"}` });
      continue;
    }
    // jest: `● suite › test`
    if ((m = /^\s*● (.+? › .+)$/.exec(line))) {
      add({ severity: "error", message: `test failed: ${m[1]}` });
      continue;
    }
    if ((m = /^\s*Tests?:?\s+(\d+ .*)$/.exec(line)) && !/^\s*Test Files/.test(line)) {
      summaries.push(m[1].trim());
      const ran = count(m[1], "passed") + count(m[1], "failed");
      // `0 total` alone is also what a suite that failed to load prints, so only skipped tests prove a filter matched nothing.
      if (ran > 0) jsRan += ran;
      else if (count(m[1], "skipped") + count(m[1], "todo") > 0) jsNone = true;
      continue;
    }
    if (/^\s*No tests? (?:files? )?found\b/i.test(line)) {
      jsNone = true;
      continue;
    }
    // pytest
    if ((m = /^_+ ERROR collecting (\S+) _+$/.exec(line))) {
      collecting = m[1];
      continue;
    }
    if (collecting && (m = /^E\s+(.+)$/.exec(line))) {
      if (!collectionMessages.has(collecting)) collectionMessages.set(collecting, m[1]);
      continue;
    }
    if ((m = /^(FAILED|ERROR) (\S*?\.py)(?:::(\S+))?(?: - (.*))?$/.exec(line))) {
      const name = m[3] ? `${m[2]}::${m[3]}` : m[2];
      const message = m[4] ?? collectionMessages.get(m[2]) ?? (m[1] === "ERROR" ? "error during collection" : "failed");
      pytestFailures.push({ severity: "error", file: m[2], message: `${name}: ${message}` });
      continue;
    }
    if ((m = /^(\S+\.py):(\d+): (\S.*)$/.exec(line))) {
      pytestLocations.push({ file: m[1], line: Number(m[2]), used: false });
      // fall through: mypy prints `file.py:12: error: ...`, which the generic rule below reads
    }
    if ((m = /^=+ (.+?) in [\d.]+s(?: \([^)]*\))? =+$/.exec(line))) {
      summaries.push(m[1]);
      pytestSummary = true;
      pytestRan += count(m[1], "passed") + count(m[1], "failed") + count(m[1], "error") + count(m[1], "errors") + count(m[1], "xfailed") + count(m[1], "xpassed");
      continue;
    }
    // go: `./main.go:10:2: undefined: x`, `--- FAIL: TestName`, per-package FAIL / ok
    if ((m = /^\s*(?:\.\/)?(\S+?\.go):(\d+):(?:(\d+):)? (.+)$/.exec(line))) {
      add({ severity: "error", file: m[1], line: Number(m[2]), column: m[3] ? Number(m[3]) : undefined, message: m[4] });
      continue;
    }
    if ((m = /^--- FAIL: (\S+)/.exec(line))) {
      add({ severity: "error", message: `test failed: ${m[1]}` });
      continue;
    }
    if (/^FAIL\s+\S+/.test(line)) goFailedPackages += 1;
    else if (/^ok\s+\S+\s/.test(line)) {
      goOkPackages += 1;
      if (/\[no tests to run\]/.test(line)) goNoTestPackages += 1;
      else goRanPackages += 1;
    } else if (/^\?\s+\S+\s+\[no test files\]/.test(line)) goNoTestPackages += 1;
    // eslint (stylish)
    if ((m = /^\s+(\d+):(\d+)\s+(error|warning)\s+(.+?)(?:\s{2,}(\S+))?\s*$/.exec(line)) && eslintFile) {
      add({ severity: m[3] as Severity, file: eslintFile, line: Number(m[1]), column: Number(m[2]), code: m[5], message: m[4] });
      continue;
    }
    if (line && !/^\s/.test(line) && !line.startsWith("✖") && /\s+\d+:\d+\s+(error|warning)\s/.test(lines[i + 1] ?? "")) {
      eslintFile = line.trim();
      continue;
    }
    if ((m = /^✖ (\d+ problems? \(.*\))\s*$/.exec(line))) {
      summaries.push(m[1]);
      continue;
    }
    // ruff (concise): file:line:col: CODE message
    if ((m = /^(\S+?\.[A-Za-z0-9]+):(\d+):(\d+): ([A-Z]{1,4}\d{2,4}) (?:\[\*\] )?(.+)$/.exec(line))) {
      add({ severity: "error", file: m[1], line: Number(m[2]), column: Number(m[3]), code: m[4], message: m[5] });
      continue;
    }
    if ((m = /^Found (\d+ errors?)\.$/.exec(line))) {
      summaries.push(m[1]);
      continue;
    }
    // maven and kotlin
    if ((m = /^\[ERROR\]\s+(\S+?):\[(\d+),(\d+)\]\s+(.+)$/.exec(line))) {
      add({ severity: "error", file: m[1], line: Number(m[2]), column: Number(m[3]), message: m[4] });
      continue;
    }
    if ((m = /^([ew]): (?:file:\/\/)?(\S+?): \((\d+), (\d+)\): (.+)$/.exec(line))) {
      add({ severity: m[1] === "e" ? "error" : "warning", file: m[2], line: Number(m[3]), column: Number(m[4]), message: m[5] });
      continue;
    }
    // gcc, clang, javac, mypy: file:line[:col]: error: message
    if ((m = /^(\S+?\.[A-Za-z0-9]+):(\d+)(?::(\d+))?: (error|warning|fatal error): (.+)$/.exec(line))) {
      add({ severity: m[4] === "warning" ? "warning" : "error", file: m[1], line: Number(m[2]), column: m[3] ? Number(m[3]) : undefined, message: m[5] });
      continue;
    }
  }

  // pytest failures take their line number from the traceback location printed above them.
  for (const failure of pytestFailures) {
    const located = pytestLocations.find((location) => !location.used && location.file === failure.file);
    if (located) {
      located.used = true;
      failure.line = located.line;
    }
    add(failure);
  }
  // A cargo test that failed without a panic line still gets listed.
  for (const name of failedTests) {
    if (!panickedTests.has(name)) add({ severity: "error", message: `test failed: ${name}` });
  }
  if (cargoCounts.seen) summaries.push(`${cargoCounts.passed} passed, ${cargoCounts.failed} failed`);
  if (goFailedPackages > 0) summaries.push(`${plural(goFailedPackages, "package")} failed`);
  else if (goOkPackages > 0) summaries.push(`${plural(goOkPackages, "package")} ok`);

  const testsRun = (() => {
    if (cargoCounts.seen) return cargoCounts.passed + cargoCounts.failed;
    if (jsRan > 0) return jsRan;
    if (jsNone) return 0;
    if (pytestSummary) return pytestRan;
    if (goRanPackages > 0 || (goFailedPackages > 0 && goNoTestPackages === 0)) return goRanPackages + goFailedPackages;
    // A failing package may be one that did not build, which says nothing about the filter.
    if (goNoTestPackages > 0 && goFailedPackages === 0) return 0;
    return undefined;
  })();

  const seen = new Set<string>();
  const unique = issues.filter((issue) => {
    const key = `${issue.severity}|${issue.file ?? ""}|${issue.line ?? ""}|${issue.column ?? ""}|${issue.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return { issues: unique, summary: summaries.length > 0 ? [...new Set(summaries)].join("; ") : undefined, testsRun };
}

// ---------- Why it failed ----------

const MISSING_SCRIPT = /Missing script: "?([^"\s]+)"?|ERR_PNPM_(?:RECURSIVE_RUN_)?NO_SCRIPT|error Command "[^"]+" not found|error Couldn't find a script named/i;
const MISSING_MANIFEST = /could not find `Cargo\.toml`|ENOENT.*package\.json|no such file or directory.*package\.json|Could not find a Gradle build|pom\.xml.*does not exist|go: go\.mod file not found|No pyproject\.toml/i;
const MISSING_TOOL = /command not found|is not recognized as an internal or external command|spawn \S+ ENOENT|The system cannot find the file specified/i;
const MISSING_PACKAGE = new RegExp([
  "Cannot find module '(?![./])[^']+'",
  "ERR_MODULE_NOT_FOUND",
  "Failed to resolve import \"(?![./])[^\"]+\"",
  "ModuleNotFoundError: No module named",
  "ImportError: No module named",
  "no matching package named",
  "failed to get `[^`]+` as a dependency",
  "failed to download",
  "Unable to update registry",
  "no required module provides package",
  "cannot find package",
].join("|"), "i");

export interface FailureInput {
  exitCode: number | null;
  timedOut: boolean;
  cancelled: boolean;
  output: string;
  /** The project's dependencies are known not to be installed. */
  installNeeded: boolean;
  /** The program that was run, when it could not even be started. */
  startError?: string;
  program?: string;
}

/**
 * Whether a failed check is about the code, and if not, what to do instead.
 * "Dependencies" is only asserted when the project's dependencies are known
 * to be missing; an unresolved package in a project that has them installed
 * may just be a dependency the code forgot to declare, so it stays "code"
 * with a hint.
 */
export function classifyFailure(input: FailureInput): Failure {
  const output = stripAnsi(input.output);
  if (input.cancelled) return { kind: "cancelled", hint: "The check was cancelled before it finished, so it proved nothing." };
  if (input.timedOut) return { kind: "timeout", hint: "The check timed out. It may be hung or just slow: try again with a larger timeout_seconds, or run a narrower command with run_command." };
  if (input.startError !== undefined) {
    return { kind: "missing-tool", hint: `The program${input.program ? ` '${input.program}'` : ""} could not be started (${input.startError}). It is probably not installed or not on PATH; editing code will not fix that.` };
  }
  const script = MISSING_SCRIPT.exec(output);
  if (script) return { kind: "missing-script", hint: `The project has no such script${script[1] ? ` ('${script[1]}')` : ""}, so the check was not run. Call project_info to see the commands that exist.` };
  if (MISSING_MANIFEST.test(output)) return { kind: "missing-manifest", hint: "The command could not find its project manifest from this folder. Call project_info with a path to check the right folder." };
  if (input.exitCode === 127 || MISSING_TOOL.test(output)) {
    return input.installNeeded
      ? { kind: "dependencies", hint: "A tool the check needs is missing because the project's dependencies are not installed. Call install_dependencies first, then run the check again; editing code will not fix this." }
      : { kind: "missing-tool", hint: "A program the check needs is not installed or not on PATH. Install it; editing code will not fix this." };
  }
  if (MISSING_PACKAGE.test(output)) {
    return input.installNeeded
      ? { kind: "dependencies", hint: "The project's dependencies are not installed. Call install_dependencies first, then run the check again; editing code will not fix this." }
      : { kind: "code", hint: "Some errors are unresolved packages. If the package is listed in the project's manifest, dependencies are out of date: call install_dependencies. If it is not listed, the code uses a dependency that was never added." };
  }
  return { kind: "code", hint: "" };
}
