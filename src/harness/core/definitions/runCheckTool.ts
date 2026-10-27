import type { CheckEvidenceLedger } from "../checkEvidence";
import { formatDuration, lastDuration, recordDuration, takeProjectTurn, type CheckKey, type ProjectTurn } from "../checkHistory";
// ============================================================
// definitions/runCheckTool.ts -- "run_check": run one of the project's own
// checks (typecheck, lint, test, build, format, install) and get a verdict a
// model cannot misread.
//
// `run_command` returns the command's text with the exit code appended, and
// reports `ok: true` even when the command failed, so a failed build looks
// like a successful tool call to the model and to the rules engine alike.
// `run_check` instead:
//  - picks the command from the same analysis `project_info` uses, so the
//    model never guesses `npm test` vs `cargo test` vs `pytest`;
//  - decides pass/fail from the exit status;
//  - returns a failure as a failed tool call (`ok: false`), which is what
//    makes rusty-core fire its failure events and rules;
//  - reads the output into errors with file:line, test tallies, and whether
//    the failure is about the code at all (checkOutput.ts / checkReport.ts);
//  - for the test check, can run just one test or one file (`test_name`,
//    `test_file`; testFilter.ts) and counts a filter that matched nothing as
//    a failure, since several runners exit 0 for it.
//
// Approval is not bypassed: every command goes through `runWithApproval`, the
// same permission dialog and executor `run_command` uses.
// ============================================================

import { normalizeCommand, formatCommand, runWithApproval, type GatedRunCommandOptions } from "./runCommandTool";
import type { NormalizedCommand } from "../../commandPolicy";
import type { HostToolHandler } from "../CoreHarness";
import { formatCheckReport, judgeRun, reportPassed, settleNarrowed, type CheckReport, type CommandOutcome } from "../checkReport";
import { analyzeProject, narrowToMember, selectChecks, type Check, type CheckId } from "../projectInfo";
import { scanProject } from "../projectScan";
import type { HostToolSpec } from "../SessionRecipe";
import { describeSelector, narrowTestCheck, parseSelector, type TestSelector } from "../testFilter";

/**
 * The checks `run_check` runs: the ones that verify the project. Installing
 * dependencies is deliberately a different tool (`install_dependencies`,
 * below). It changes the workspace and proves nothing about the code, so it
 * must never count as having checked it: a rule or gate that asks for "a
 * check ran since your last edit" would otherwise be satisfied by an install.
 */
export const CHECK_IDS: readonly CheckId[] = ["typecheck", "lint", "test", "build", "format"];

const isCheckId = (value: string): value is CheckId => (CHECK_IDS as readonly string[]).includes(value);

type Outcome = Awaited<ReturnType<HostToolHandler>>;
export type CheckToolOptions = GatedRunCommandOptions & { evidence?: CheckEvidenceLedger };

/**
 * How long each kind of check may print nothing before it is stopped as hung.
 * A check is not given a fixed time to finish: a large project's test run
 * takes ten minutes or more and keeps printing; a hung one goes quiet.
 */
const DEFAULT_IDLE_MS: Record<CheckId, number> = {
  install: 10 * 60_000,
  typecheck: 5 * 60_000,
  lint: 5 * 60_000,
  test: 10 * 60_000,
  build: 15 * 60_000,
  format: 3 * 60_000,
};
/** The most any check may run in all, and what it gets when none is asked for. */
export const CHECK_MAX_MS = 60 * 60_000;

export const RUN_CHECK_TOOL: HostToolSpec = {
  name: "run_check",
  description:
    "Run one of the project's own checks and get a clear pass or fail, instead of guessing a command. The commands come from project_info (package.json scripts, Cargo, pyproject, go.mod, Makefile), so you do not need to know them. The result starts with PASSED or FAILED. A failure lists its errors as file:line: message, shows test tallies, and says whether the cause is the code or the environment (missing project dependencies may need installation; a missing executable is an environment blocker and cannot be fixed by invoking that same program again). A failing check is reported as a failed tool call. To run just one test while you work on it, give the test check test_name (a name or part of one) and/or test_file; this works for vitest, jest, pytest, cargo test and go test, and a filter that matches no test is reported as FAILED, not as a pass. Use focused checks while implementing a task; run required integration checks at the final validation stage. Matching host evidence may be reused within this run; set fresh for independent execution. In a workspace with several projects, pass path to choose one. As with run_command, each command is shown to the user for approval. Use run_command only for something this cannot express.",
  input_schema: {
    type: "object",
    properties: {
      fresh: { type: "boolean", description: "Force a fresh execution instead of reusing matching evidence from this run." },
      check: {
        type: "string",
        enum: [...CHECK_IDS],
        description: "Which check to run: typecheck, lint, test, build, or format (style only).",
      },
      path: { type: "string", description: "The project's folder, relative to the workspace root. Needed when more than one project has this check." },
      test_name: {
        type: "string",
        description: "Only for check: test. Run only the tests whose name contains this text, for example \"adds two numbers\" (vitest, jest), \"test_adds\" (pytest), \"parser::tests::empty_input\" (cargo) or \"TestParse\" (go). Treated as plain text, not a pattern.",
      },
      test_file: {
        type: "string",
        description: "Only for check: test. Run only the tests in this file, relative to the workspace root, for example src/math.test.ts. For cargo it must be a file under tests/; for go it runs that file's package.",
      },
      timeout_seconds: { type: "number", description: "An overall limit, 1 to 3600 seconds. Usually leave it out: a check runs for as long as it keeps printing (up to an hour), and one that prints nothing for several minutes is stopped as hung." },
      background: { type: "boolean", description: "Run it as a background job and return at once, for a slow check (a full test suite or build): you keep working and are told when it finishes; read it with job_output. The result says how long the check took last time." },
    },
    required: ["check"],
  },
};

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

interface DetectedRunInput {
  path?: unknown;
  timeout_seconds?: unknown;
  test_name?: unknown;
  test_file?: unknown;
  fresh?: unknown;
}

/** The commands to run for a narrowed test check, or why there are none. */
function narrowAll(checks: Check[], selector: TestSelector): { ok: true; checks: Check[] } | { ok: false; error: string } {
  const results = checks.map((check) => narrowTestCheck(check, selector));
  const invalid = results.find((result) => !result.ok && result.kind === "invalid");
  if (invalid && !invalid.ok) return { ok: false, error: invalid.error };
  const usable = results.flatMap((result) => (result.ok ? [result.check] : []));
  if (usable.length > 0) return { ok: true, checks: usable };
  return { ok: false, error: results.flatMap((result) => (result.ok ? [] : [result.error])).join(" ") };
}

/**
 * Resolves the `id` command(s) from the project analysis, puts each to the
 * user for approval, runs them, and writes the verdict. Shared by `run_check`
 * and `install_dependencies`, which differ only in which detected command they
 * mean and how they describe it.
 */
async function runDetected(options: CheckToolOptions, id: CheckId, input: DetectedRunInput, signal: AbortSignal): Promise<Outcome> {
  const { workspaceRoot, host } = options;
  const installing = id === "install";
  if (!workspaceRoot.trim()) {
    return { ok: false, error: installing ? "No workspace is open, so there is nothing to install." : "No workspace is open, so there is no project to check." };
  }

  let selection: ReturnType<typeof selectChecks>;
  try {
    const fs = await scanProject(workspaceRoot, host, signal);
    const info = await analyzeProject(fs);
    const requestedPath = typeof input.path === "string" ? input.path : "";
    selection = selectChecks(info, id, requestedPath);
    if (selection.ok) {
      const narrowed = await narrowToMember(fs, selection.project, selection.checks, requestedPath);
      selection = { ...selection, checks: narrowed.checks };
    }
  } catch (error: unknown) {
    return { ok: false, error: message(error) };
  }
  if (!selection.ok) return { ok: false, error: selection.error };

  const parsed = parseSelector(input.test_name, input.test_file);
  if (!parsed.ok) return { ok: false, error: parsed.error };
  const narrowing = Object.keys(parsed.selector).length > 0;
  if (narrowing && id !== "test") return { ok: false, error: "test_name and test_file only apply to check: test." };
  let commands = selection.checks;
  if (narrowing) {
    const narrowedChecks = narrowAll(commands, parsed.selector);
    if (!narrowedChecks.ok) return { ok: false, error: narrowedChecks.error };
    commands = narrowedChecks.checks;
  }
  const only = narrowing ? describeSelector(parsed.selector) : undefined;

  const seconds = Number(input.timeout_seconds);
  const timeoutMs = Number.isFinite(seconds) && seconds > 0 ? Math.min(Math.max(seconds * 1000, 1000), CHECK_MAX_MS) : CHECK_MAX_MS;
  const idleTimeoutMs = Math.min(DEFAULT_IDLE_MS[id], timeoutMs);
  // Dependencies being missing only explains a failure of the checks that need them.
  const installNeeded = selection.installNeeded && !installing;

  const evidenceKey = JSON.stringify({ id, commands, only });
  const before = !installing ? await options.evidence?.fingerprint() : undefined;
  const cached = input.fresh === true ? undefined : options.evidence?.find(evidenceKey, before);
  if (cached?.result.ok) return { ok: true, output: `${cached.result.output}\nHost evidence ${cached.id}: reused matching workspace inputs from this run; no command was rerun.` };
  options.evidence?.forget(evidenceKey);
  if (installing) options.evidence?.invalidate();
  const outcomes: CommandOutcome[] = [];
  const report = (): CheckReport => ({ check: id, project: selection.project.path, outcomes: only ? settleNarrowed(outcomes, only) : outcomes, only });
  const total = commands.length;
  const history: CheckKey = { workspaceRoot, project: selection.project.path, check: id, only };
  const usual = lastDuration(history);
  const projectName = selection.project.path === "." ? "this project" : selection.project.path;

  let turn: ProjectTurn;
  try {
    turn = await takeProjectTurn(workspaceRoot, selection.project.path, signal, () => {
      options.onEvent({ kind: "log", message: `Waiting for the other check on ${projectName} to finish.` });
    });
  } catch (error: unknown) {
    return { ok: false, error: `Stopped: ${message(error)}; the ${id} check was not run.` };
  }
  try {
    return await runCommands();
  } finally {
    turn.release();
  }

  async function runCommands(): Promise<Outcome> {
  for (const [index, detected] of commands.entries()) {
    let command: NormalizedCommand;
    try {
      // run_command caps its own limit lower; a check is bounded by its idle limit instead.
      command = { ...normalizeCommand({ program: detected.program, args: detected.args, cwd: detected.cwd }, workspaceRoot), timeoutMs };
    } catch (error: unknown) {
      return { ok: false, error: message(error) };
    }
    const qualifiers = [total > 1 ? `${index + 1} of ${total}` : undefined, only ? `only ${only}` : undefined].filter(Boolean);
    const which = qualifiers.length > 0 ? ` (${qualifiers.join(", ")})` : "";
    const purpose = installing ? "install the project's dependencies" : `run the project's ${id} check`;
    const lastTime = usual !== undefined && index === 0 ? ` It took ${formatDuration(usual)} last time.` : "";
    const run = await runWithApproval(command, options, signal, `The agent wants to ${purpose}${which}: ${formatCommand(command)}${lastTime ? `.${lastTime}` : ""}`, idleTimeoutMs);

    if (run.status === "refused") {
      const consequence = installing ? "so nothing was installed" : "so this check is incomplete and proves nothing";
      const stopped = `Stopped: ${run.error} \`${formatCommand(command)}\` was not run, ${consequence}.`;
      return { ok: false, error: outcomes.length > 0 ? `${formatCheckReport(report())}\n\n${stopped}` : stopped };
    }
    const base = { command: formatCommand(command), cwd: detected.cwd, note: detected.note, program: command.program };
    outcomes.push(
      judgeRun(
        run.status === "ran"
          ? {
            ...base, exitCode: run.result.exit_code, durationMs: run.durationMs, timedOut: run.result.timed_out, cancelled: run.result.cancelled === true,
            idle: run.result.idle === true, output: run.result.output, logPath: run.result.log_path ?? undefined,
          }
          : { ...base, exitCode: null, durationMs: 0, timedOut: false, cancelled: false, output: "", startError: run.error },
        installNeeded,
      ),
    );
    if (signal.aborted) break;
    // No other check can repair a missing executable. Report the prerequisite
    // once instead of spending the remainder of the run repeating it.
    if (run.status === "failed-to-start") break;
    // One test belongs to one runner: once a command has run it, the rest have nothing to add.
    if (narrowing && (outcomes[outcomes.length - 1].testsRun ?? 0) > 0) break;
  }

  // A run that went to the end tells how long this check takes; a stopped one does not.
  const ranToEnd = outcomes.length > 0 && !signal.aborted && outcomes.every((outcome) => !outcome.timedOut && !outcome.cancelled && outcome.startError === undefined);
  const tookMs = outcomes.reduce((sum, outcome) => sum + outcome.durationMs, 0);
  if (ranToEnd) recordDuration(history, tookMs);
  const notes = [
    turn.waitedMs >= 1000 ? `Waited ${formatDuration(turn.waitedMs)} for another check on ${projectName} to finish first.` : undefined,
    usual !== undefined && ranToEnd ? `It took ${formatDuration(tookMs)} (${formatDuration(usual)} last time).` : undefined,
    usual !== undefined && !ranToEnd ? `It ran to the end in ${formatDuration(usual)} last time.` : undefined,
  ].filter(Boolean);
  const text = [formatCheckReport(report()), ...notes].join("\n");
  const result: Outcome = reportPassed(report()) && !signal.aborted ? { ok: true, output: text } : { ok: false, error: text };
  const receipt = options.evidence?.record(evidenceKey, before, await options.evidence.fingerprint(), result);
  return receipt && result.ok ? { ok: true, output: `${text}\nHost evidence: ${receipt.id}` } : result;
  }
}

export function runCheckTool(options: CheckToolOptions): HostToolHandler {
  return async (args, signal) => {
    const input = (args ?? {}) as DetectedRunInput & { check?: unknown };
    const requested = typeof input.check === "string" ? input.check.trim().toLowerCase() : "";
    if (requested === "install") {
      return { ok: false, error: "run_check only verifies the project. To install its dependencies call install_dependencies." };
    }
    if (!isCheckId(requested)) {
      return { ok: false, error: `check must be one of: ${CHECK_IDS.join(", ")}.` };
    }
    return runDetected(options, requested, input, signal);
  };
}

export const INSTALL_DEPENDENCIES_TOOL: HostToolSpec = {
  name: "install_dependencies",
  description:
    "Install the project's dependencies with its own package manager (npm ci or npm install, pnpm, yarn, bun, uv sync, poetry install, pip install -r requirements.txt), after the user approves the command. Use it when project_info says dependencies are NOT installed, or when a check identifies missing project dependencies. A missing package-manager executable is an environment blocker; this tool cannot install that executable. This is not a check and proves nothing about the code: once it succeeds, run the check you were running again.",
  input_schema: {
    type: "object",
    properties: {
      path: { type: "string", description: "The project's folder, relative to the workspace root. Needed when more than one project needs installing." },
      timeout_seconds: { type: "number", description: "An overall limit, 1 to 3600 seconds. Usually leave it out: it runs for as long as it keeps printing (up to an hour), and is stopped as hung after ten minutes without output." },
    },
    required: [],
  },
};

export function installDependenciesTool(options: CheckToolOptions): HostToolHandler {
  return async (args, signal) => runDetected(options, "install", (args ?? {}) as DetectedRunInput, signal);
}
