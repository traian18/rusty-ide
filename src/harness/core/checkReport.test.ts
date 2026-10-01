import { describe, expect, it } from "vitest";

import { formatCheckReport, judgeRun, reportPassed, settleNarrowed, type CheckReport, type CommandRun } from "./checkReport";

import cargoCheck from "./__fixtures__/checks/cargo_check.txt?raw";
import cargoTest from "./__fixtures__/checks/cargo_test.txt?raw";
import cargoTestMatch from "./__fixtures__/checks/cargo_test_match.txt?raw";
import cargoTestNoMatch from "./__fixtures__/checks/cargo_test_nomatch.txt?raw";
import npmMissingScript from "./__fixtures__/checks/npm_missing_script.txt?raw";
import npmMissingTool from "./__fixtures__/checks/npm_missing_tool.txt?raw";
import pytestFailures from "./__fixtures__/checks/pytest.txt?raw";
import pytestNoMatch from "./__fixtures__/checks/pytest_nomatch.txt?raw";
import vitestNameNoMatch from "./__fixtures__/checks/vitest_name_nomatch.txt?raw";
import tsc from "./__fixtures__/checks/tsc.txt?raw";

const run = (overrides: Partial<CommandRun> = {}): CommandRun => ({
  command: "npm run typecheck",
  cwd: "rusty-ide",
  exitCode: 0,
  durationMs: 4200,
  timedOut: false,
  cancelled: false,
  output: "",
  ...overrides,
});

const report = (outcomes: ReturnType<typeof judgeRun>[], check: CheckReport["check"] = "typecheck", project = "rusty-ide"): CheckReport => ({ check, project, outcomes });

describe("judgeRun", () => {
  it("decides pass or fail from the exit status alone", () => {
    expect(judgeRun(run({ exitCode: 0 }), false).passed).toBe(true);
    expect(judgeRun(run({ exitCode: 1 }), false).passed).toBe(false);
    // Prose that looks like failure does not make a zero exit fail, and the reverse.
    expect(judgeRun(run({ exitCode: 0, output: "error: 3 errors found" }), false).passed).toBe(true);
    expect(judgeRun(run({ exitCode: 1, output: "all good" }), false).passed).toBe(false);
  });

  it("never passes a timeout, a cancellation, a missing exit status or a command that could not start", () => {
    expect(judgeRun(run({ exitCode: 0, timedOut: true }), false).passed).toBe(false);
    expect(judgeRun(run({ exitCode: 0, cancelled: true }), false).passed).toBe(false);
    expect(judgeRun(run({ exitCode: null }), false).passed).toBe(false);
    expect(judgeRun(run({ exitCode: null, startError: "No such file" }), false).passed).toBe(false);
  });

  it("parses and classifies only what failed", () => {
    const passed = judgeRun(run({ output: tsc }), false);
    expect(passed.failure).toBeUndefined();
    const failed = judgeRun(run({ exitCode: 2, output: tsc }), false);
    expect(failed.failure).toEqual({ kind: "code", hint: "" });
    expect(failed.issues).toHaveLength(3);
  });
});

describe("formatCheckReport", () => {
  it("leads with FAILED and lists errors as file:line:col, without repeating them in a tail", () => {
    const text = formatCheckReport(report([judgeRun(run({ exitCode: 2, output: tsc }), false)]));
    expect(text).toBe(
      [
        "typecheck for rusty-ide: FAILED",
        "",
        "[1/1] npm run typecheck (cwd: rusty-ide): FAILED (exit 2) in 4.2s",
        "  3 errors:",
        "  - src/a.ts:1:14 [TS2322] Type 'string' is not assignable to type 'number'.",
        "  - src/a.ts:2:58 [TS2552] Cannot find name 'undefinedName'. Did you mean 'undefined'?",
        "  - src/a.ts:3:22 [TS2307] Cannot find module './missing' or its corresponding type declarations.",
        "",
        "Overall: FAILED (1 of 1 command failed). Fix the errors listed above, then call run_check again to confirm. Do not report this as passing until it does.",
      ].join("\n"),
    );
  });

  it("reports a pass briefly, with the root named plainly", () => {
    const text = formatCheckReport(report([judgeRun(run({ cwd: ".", durationMs: 1500, output: "built" }), false)], "build", "."));
    expect(text).toBe(["build for the workspace root: PASSED", "", "[1/1] npm run typecheck: passed in 1.5s", "", "Overall: PASSED (1 command, 1.5s)."].join("\n"));
  });

  it("shows a test tally, and the failing tests with their locations", () => {
    const text = formatCheckReport(report([judgeRun(run({ command: "cargo test", cwd: "core", exitCode: 101, output: cargoTest }), false)], "test", "core"));
    expect(text).toContain("Result: 1 passed, 2 failed");
    expect(text).toContain("2 errors:");
    expect(text).toContain("- src/lib.rs:6:29 tests::fails_eq: assertion `left == right` failed | left: 3 | right: 4");
    expect(text).toContain("- src/lib.rs:7:27 tests::panics: boom 42");
    const pytest = formatCheckReport(report([judgeRun(run({ command: "python -m pytest", cwd: ".", exitCode: 1, output: pytestFailures }), false)], "test", "."));
    expect(pytest).toContain("Result: 2 failed, 1 passed");
    expect(pytest).toContain("- test_x.py:5 test_x.py::test_bad: assert (1 + 1) == 3");
  });

  it("lists warnings on a pass but only counts them on a failure", () => {
    const warning = "src/main.rs(1,1): warning W1: careless";
    const passed = formatCheckReport(report([judgeRun(run({ command: "cargo clippy", exitCode: 0, output: warning }), false)], "lint"));
    expect(passed).toContain("1 warning:");
    expect(passed).toContain("- src/main.rs:1:1 [W1] careless");
    const failed = formatCheckReport(report([judgeRun(run({ command: "cargo check", exitCode: 101, output: cargoCheck }), false)], "typecheck"));
    expect(failed).toContain("1 warning (not listed):");
    expect(failed).not.toContain("unused variable");
    expect(failed).toContain("mismatched types");
  });

  it("puts an environment cause before anything else and ends with what to do about it", () => {
    const outcome = judgeRun(run({ exitCode: 127, output: npmMissingTool }), true);
    const text = formatCheckReport(report([outcome]));
    expect(text).toContain("Cause (not a code problem): A tool the check needs is missing because the project's dependencies are not installed.");
    expect(text).toContain("sh: tsc: command not found");
    expect(text.split("\n").at(-1)).toMatch(/^Overall: FAILED \(1 of 1 command failed\)\. A tool the check needs is missing .* Call install_dependencies first, then run the check again/);
    expect(text).not.toContain("Fix the errors listed above");
  });

  it("explains a missing script and keeps the output short", () => {
    const text = formatCheckReport(report([judgeRun(run({ command: "npm run nothere", exitCode: 1, output: npmMissingScript }), false)]));
    expect(text).toContain("Cause (not a code problem): The project has no such script ('nothere')");
    expect(text).toContain("Output (last");
  });

  it("shows the tail of output the parser understood nothing of", () => {
    const output = Array.from({ length: 60 }, (_, i) => `line ${i + 1}`).join("\n");
    const text = formatCheckReport(report([judgeRun(run({ exitCode: 1, output }), false)]));
    expect(text).toContain("Output (last 40 lines):");
    expect(text).toContain("    line 60");
    expect(text).toContain("    line 21");
    expect(text).not.toContain("    line 20\n");
  });

  it("caps a long error list and says how many were left out", () => {
    const output = Array.from({ length: 40 }, (_, i) => `src/f${i}.ts(1,1): error TS1: bad ${i}`).join("\n");
    const text = formatCheckReport(report([judgeRun(run({ exitCode: 2, output }), false)]));
    expect(text).toContain("40 errors:");
    expect(text).toContain("- src/f24.ts:1:1 [TS1] bad 24");
    expect(text).not.toContain("bad 25");
    expect(text).toContain("... and 15 more errors");
  });

  it("describes a timeout, a cancellation and a command that could not start", () => {
    const timeout = formatCheckReport(report([judgeRun(run({ exitCode: null, timedOut: true, durationMs: 300_000 }), false)]));
    expect(timeout).toContain("FAILED: timed out after 5m 00s");
    expect(timeout).toContain("timeout_seconds");
    expect(formatCheckReport(report([judgeRun(run({ exitCode: null, cancelled: true }), false)]))).toContain("CANCELLED");
    const start = formatCheckReport(report([judgeRun(run({ command: "cargo check", exitCode: null, startError: "No such file or directory", program: "cargo" }), false)]));
    expect(start).toContain("FAILED: could not be started");
    expect(start).toContain("'cargo'");
  });

  it("covers several commands: passing ones are still shown, and the failure count is exact", () => {
    const text = formatCheckReport(
      report(
        [
          judgeRun(run({ command: "npm run typecheck", cwd: "app", exitCode: 2, output: tsc }), false),
          judgeRun(run({ command: "cargo check", cwd: "app/src-tauri", exitCode: 0, durationMs: 18_100 }), false),
        ],
        "typecheck",
        "app",
      ),
    );
    expect(text).toContain("[1/2] npm run typecheck (cwd: app): FAILED (exit 2) in 4.2s");
    expect(text).toContain("[2/2] cargo check (cwd: app/src-tauri): passed in 18.1s");
    expect(text).toContain("Overall: FAILED (1 of 2 commands failed).");
  });

  it("keeps a detection caveat visible on a failure, such as a formatter's style-only note", () => {
    const text = formatCheckReport(report([judgeRun(run({ command: "cargo fmt --check", exitCode: 1, note: "style only: a failure does not mean the code is broken", output: "Diff in src/lib.rs" }), false)], "format"));
    expect(text).toContain("Note: style only: a failure does not mean the code is broken");
  });

  it("notes the hint for a package the code may never have declared, without calling it environmental", () => {
    const output = "src/a.ts(3,22): error TS2307: Cannot find module 'left-pad' or its corresponding type declarations.";
    const text = formatCheckReport(report([judgeRun(run({ exitCode: 2, output }), false)]));
    expect(text).toContain("Note: Some errors are unresolved packages.");
    expect(text).not.toContain("not a code problem");
    expect(text).toContain("Fix the errors listed above");
  });
});

describe("reportPassed", () => {
  it("needs at least one command and every one to have passed", () => {
    expect(reportPassed(report([]))).toBe(false);
    expect(reportPassed(report([judgeRun(run(), false)]))).toBe(true);
    expect(reportPassed(report([judgeRun(run(), false), judgeRun(run({ exitCode: 1 }), false)]))).toBe(false);
  });
});

describe("a run narrowed to one test", () => {
  const only = 'test_name "zzznomatch"';
  const judged = (output: string, exitCode: number | null = 0, command = "cargo test zzznomatch") => judgeRun(run({ command, exitCode, output }), false);

  it("fails when a clean exit says nothing ran, which is what these runners print for a filter that matches nothing", () => {
    for (const [command, output, exitCode] of [
      ["cargo test zzznomatch", cargoTestNoMatch, 0],
      ["npm run test -- -t zzznomatch", vitestNameNoMatch, 0],
      ["python -m pytest -k zzznomatch", pytestNoMatch, 5],
    ] as const) {
      const [outcome] = settleNarrowed([judged(output, exitCode, command)], only);
      expect(outcome.passed, command).toBe(false);
      expect(outcome.failure?.kind, command).toBe("no-match");
    }
  });

  it("names the filter and what to do about it, in the report a model reads", () => {
    const text = formatCheckReport({ check: "test", project: ".", only, outcomes: settleNarrowed([judged(cargoTestNoMatch)], only) });
    expect(text.startsWith('test for the workspace root (only test_name "zzznomatch"): FAILED')).toBe(true);
    expect(text).toContain('Nothing was checked: test_name "zzznomatch" matched no test.');
    expect(text).toContain("search_codebase");
    expect(text).toContain("Overall: FAILED");
  });

  it("passes when the test ran and passed, and fails as usual when it ran and failed", () => {
    const passed = settleNarrowed([judged(cargoTestMatch)], only);
    expect(reportPassed({ check: "test", project: ".", outcomes: passed })).toBe(true);
    const failed = settleNarrowed([judged(cargoTest, 101)], only);
    expect(failed[0].failure?.kind).toBe("code");
    expect(reportPassed({ check: "test", project: ".", outcomes: failed })).toBe(false);
  });

  it("does not hold a command that matched nothing against the one that ran the test", () => {
    const outcomes = settleNarrowed([judged(vitestNameNoMatch, 0, "npm run test -- -t x"), judged(cargoTestMatch)], only);
    expect(outcomes.map((outcome) => outcome.passed)).toEqual([true, true]);
    expect(outcomes[0].summary).toBe("no test here matched the filter");
    // even when the other runner reports a filter that matched nothing with a failing status
    const withFailingEmpty = settleNarrowed([judged(pytestNoMatch, 5), judged(cargoTestMatch)], only);
    expect(reportPassed({ check: "test", project: ".", outcomes: withFailingEmpty })).toBe(true);
  });

  it("leaves a run whose tally is unknown to its own verdict: silence is not 'nothing matched'", () => {
    const unknown = judged("compiling...\nerror: could not compile `demo`", 101);
    expect(unknown.testsRun).toBeUndefined();
    const [outcome] = settleNarrowed([unknown], only);
    expect(outcome.passed).toBe(false);
    expect(outcome.failure?.kind).not.toBe("no-match");
  });
});
