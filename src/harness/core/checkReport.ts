// ============================================================
// checkReport.ts -- one check run, judged and written up for a model.
// `judgeRun` decides pass or fail from the exit status (never from prose in
// the output) and runs checkOutput.ts's parser and classifier;
// `formatCheckReport` writes the result so the first line says whether it
// passed, failures lead with the errors as file:line, and a failure that is
// not about the code says so before anything else.
// ============================================================

import { classifyFailure, parseCheckOutput, stripAnsi, type Failure, type Issue } from "./checkOutput";
import type { CheckId } from "./projectInfo";

const MAX_ERRORS_SHOWN = 25;
const MAX_WARNINGS_SHOWN = 10;
const TAIL_LINES_NO_ERRORS = 40;
const TAIL_LINES_WITH_ERRORS = 8;
const TAIL_LINES_NOT_CODE = 15;
const MAX_TAIL_CHARS = 4000;

/** What running one command produced. */
export interface CommandRun {
  /** The command as typed, such as "npm run typecheck". */
  command: string;
  /** Workspace-relative working directory. */
  cwd: string;
  /** The detection's own caveat for this command, such as "style only". */
  note?: string;
  exitCode: number | null;
  durationMs: number;
  timedOut: boolean;
  cancelled: boolean;
  output: string;
  /** The command could not be started at all. */
  startError?: string;
  program?: string;
}

export interface CommandOutcome extends CommandRun {
  passed: boolean;
  failure?: Failure;
  issues: Issue[];
  summary?: string;
  /** How many tests ran; see `ParsedOutput.testsRun` for when it is zero or unknown. */
  testsRun?: number;
}

export interface CheckReport {
  check: CheckId;
  /** The project's workspace-relative folder, "." for the root. */
  project: string;
  outcomes: CommandOutcome[];
  /** What the run was narrowed to, such as `test_name "adds two"`. */
  only?: string;
}

export const reportPassed = (report: CheckReport): boolean => report.outcomes.length > 0 && report.outcomes.every((outcome) => outcome.passed);

/** Judges one run. `installNeeded` says the project's dependencies are known to be missing. */
export function judgeRun(run: CommandRun, installNeeded: boolean): CommandOutcome {
  const passed = run.exitCode === 0 && !run.timedOut && !run.cancelled && run.startError === undefined;
  const parsed = parseCheckOutput(run.output);
  const failure = passed
    ? undefined
    : classifyFailure({
        exitCode: run.exitCode,
        timedOut: run.timedOut,
        cancelled: run.cancelled,
        output: run.output,
        installNeeded,
        startError: run.startError,
        program: run.program,
      });
  return { ...run, passed, failure, issues: parsed.issues, summary: parsed.summary, testsRun: parsed.testsRun };
}

const NOTHING_MATCHED = "no test here matched the filter";

/**
 * Reads the outcomes of a run narrowed to one test. Several runners exit 0
 * (or fail with their own "no tests found" status) when a filter matches
 * nothing, so a clean exit proves nothing there: if no command ran a test,
 * the whole run fails, with a cause that points at the filter. If one command
 * did run a test, the others that matched nothing were not the right runner
 * for it and are not held against it.
 */
export function settleNarrowed(outcomes: CommandOutcome[], only: string): CommandOutcome[] {
  const none = (outcome: CommandOutcome) => outcome.testsRun === 0;
  if (outcomes.length === 0) return outcomes;
  if (outcomes.every(none)) {
    const hint = `Nothing was checked: ${only} matched no test. Call run_check without it to run everything, or use search_codebase to find the test's exact name and file.`;
    return outcomes.map((outcome) => ({ ...outcome, passed: false, failure: { kind: "no-match" as const, hint } }));
  }
  return outcomes.map((outcome) => (none(outcome) ? { ...outcome, passed: true, failure: undefined, summary: NOTHING_MATCHED } : outcome));
}

function duration(ms: number): string {
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const seconds = Math.round(ms / 1000);
  return `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, "0")}s`;
}

function tail(output: string, lines: number): string[] {
  const all = stripAnsi(output).split(/\r?\n/);
  while (all.length > 0 && all[all.length - 1].trim() === "") all.pop();
  let picked = all.slice(-lines);
  let text = picked.join("\n");
  if (text.length > MAX_TAIL_CHARS) {
    text = text.slice(-MAX_TAIL_CHARS);
    picked = text.split("\n").slice(1);
  }
  return picked;
}

function issueLine(issue: Issue): string {
  let where = "";
  if (issue.file) {
    where = issue.file;
    if (issue.line !== undefined) where += `:${issue.line}`;
    if (issue.line !== undefined && issue.column !== undefined) where += `:${issue.column}`;
  }
  const code = issue.code ? `[${issue.code}] ` : "";
  return `  - ${where ? `${where} ` : ""}${code}${issue.message}`;
}

function describeStatus(outcome: CommandOutcome): string {
  if (outcome.passed) return `passed in ${duration(outcome.durationMs)}`;
  if (outcome.cancelled) return "CANCELLED";
  if (outcome.timedOut) return `FAILED: timed out after ${duration(outcome.durationMs)}`;
  if (outcome.startError !== undefined) return "FAILED: could not be started";
  return `FAILED (${outcome.exitCode === null ? "no exit status" : `exit ${outcome.exitCode}`}) in ${duration(outcome.durationMs)}`;
}

function describeOutcome(outcome: CommandOutcome, index: number, total: number): string[] {
  const lines: string[] = [];
  const where = outcome.cwd === "." ? "" : ` (cwd: ${outcome.cwd})`;
  lines.push(`[${index}/${total}] ${outcome.command}${where}: ${describeStatus(outcome)}`);

  const errors = outcome.issues.filter((issue) => issue.severity === "error");
  const warnings = outcome.issues.filter((issue) => issue.severity === "warning");

  if (outcome.failure && outcome.failure.kind !== "code") {
    lines.push(`  Cause (not a code problem): ${outcome.failure.hint}`);
  } else if (outcome.failure?.hint) {
    lines.push(`  Note: ${outcome.failure.hint}`);
  }
  if (outcome.summary) lines.push(`  Result: ${outcome.summary}`);

  if (!outcome.passed && errors.length > 0) {
    lines.push(`  ${errors.length} ${errors.length === 1 ? "error" : "errors"}:`);
    lines.push(...errors.slice(0, MAX_ERRORS_SHOWN).map(issueLine));
    if (errors.length > MAX_ERRORS_SHOWN) lines.push(`  ... and ${errors.length - MAX_ERRORS_SHOWN} more errors`);
  }
  if (warnings.length > 0) {
    lines.push(`  ${warnings.length} ${warnings.length === 1 ? "warning" : "warnings"}${outcome.passed ? "" : " (not listed)"}:`);
    if (outcome.passed) {
      lines.push(...warnings.slice(0, MAX_WARNINGS_SHOWN).map(issueLine));
      if (warnings.length > MAX_WARNINGS_SHOWN) lines.push(`  ... and ${warnings.length - MAX_WARNINGS_SHOWN} more warnings`);
    }
  }
  if (!outcome.passed && outcome.note) lines.push(`  Note: ${outcome.note}`);

  if (!outcome.passed) {
    const wanted = outcome.failure && outcome.failure.kind !== "code" ? TAIL_LINES_NOT_CODE : errors.length === 0 ? TAIL_LINES_NO_ERRORS : TAIL_LINES_WITH_ERRORS;
    // The listed errors already say what these lines say, so leave them out of the tail.
    const shown = tail(outcome.output, wanted).filter((line) => !errors.some((issue) => line.includes(issue.message)));
    if (shown.length > 0) {
      lines.push(`  Output (last ${shown.length} ${shown.length === 1 ? "line" : "lines"}):`);
      lines.push(...shown.map((line) => `    ${line}`));
    }
  }
  return lines;
}

/** The text a model reads for a finished check. */
export function formatCheckReport(report: CheckReport): string {
  const passed = reportPassed(report);
  const where = report.project === "." ? "the workspace root" : report.project;
  const out: string[] = [`${report.check} for ${where}${report.only ? ` (only ${report.only})` : ""}: ${passed ? "PASSED" : "FAILED"}`, ""];
  report.outcomes.forEach((outcome, index) => {
    out.push(...describeOutcome(outcome, index + 1, report.outcomes.length), "");
  });

  if (passed) {
    const total = report.outcomes.reduce((sum, outcome) => sum + outcome.durationMs, 0);
    out.push(`Overall: PASSED (${report.outcomes.length === 1 ? "1 command" : `${report.outcomes.length} commands`}, ${duration(total)}).`);
  } else {
    const failed = report.outcomes.filter((outcome) => !outcome.passed);
    const notCode = failed.find((outcome) => outcome.failure && outcome.failure.kind !== "code");
    const count = `${failed.length} of ${report.outcomes.length} ${report.outcomes.length === 1 ? "command" : "commands"} failed`;
    const next = notCode?.failure
      ? notCode.failure.hint
      : "Fix the errors listed above, then call run_check again to confirm. Do not report this as passing until it does.";
    out.push(`Overall: FAILED (${count}). ${next}`);
  }
  return out.join("\n");
}
