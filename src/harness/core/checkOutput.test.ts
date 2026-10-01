import { describe, expect, it } from "vitest";

import { classifyFailure, parseCheckOutput, stripAnsi, type FailureInput } from "./checkOutput";

// Real output captured from tsc, cargo, vitest, pytest, ruff and npm (paths scrubbed).
import cargoCheck from "./__fixtures__/checks/cargo_check.txt?raw";
import cargoNoManifest from "./__fixtures__/checks/cargo_no_manifest.txt?raw";
import cargoTest from "./__fixtures__/checks/cargo_test.txt?raw";
import cargoTestMatch from "./__fixtures__/checks/cargo_test_match.txt?raw";
import cargoTestNoMatch from "./__fixtures__/checks/cargo_test_nomatch.txt?raw";
import npmMissingScript from "./__fixtures__/checks/npm_missing_script.txt?raw";
import npmMissingTool from "./__fixtures__/checks/npm_missing_tool.txt?raw";
import pytestFailures from "./__fixtures__/checks/pytest.txt?raw";
import pytestFileNoMatch from "./__fixtures__/checks/pytest_file_nomatch.txt?raw";
import pytestImportError from "./__fixtures__/checks/pytest_import_error.txt?raw";
import pytestMatch from "./__fixtures__/checks/pytest_match.txt?raw";
import pytestNoMatch from "./__fixtures__/checks/pytest_nomatch.txt?raw";
import ruff from "./__fixtures__/checks/ruff.txt?raw";
import tsc from "./__fixtures__/checks/tsc.txt?raw";
import vitest from "./__fixtures__/checks/vitest.txt?raw";
import vitestFileNoMatch from "./__fixtures__/checks/vitest_file_nomatch.txt?raw";
import vitestNameMatch from "./__fixtures__/checks/vitest_name_match.txt?raw";
import vitestNameNoMatch from "./__fixtures__/checks/vitest_name_nomatch.txt?raw";

describe("parseCheckOutput on real output", () => {
  it("reads tsc errors with file, line, column and code", () => {
    expect(parseCheckOutput(tsc)).toEqual({
      issues: [
        { severity: "error", file: "src/a.ts", line: 1, column: 14, code: "TS2322", message: "Type 'string' is not assignable to type 'number'." },
        { severity: "error", file: "src/a.ts", line: 2, column: 58, code: "TS2552", message: "Cannot find name 'undefinedName'. Did you mean 'undefined'?" },
        { severity: "error", file: "src/a.ts", line: 3, column: 22, code: "TS2307", message: "Cannot find module './missing' or its corresponding type declarations." },
      ],
      summary: undefined,
    });
  });

  it("reads rustc errors and warnings from cargo check, ignoring the lines that only summarize them", () => {
    const { issues, summary } = parseCheckOutput(cargoCheck);
    expect(issues).toEqual([
      { severity: "error", code: "E0308", message: "mismatched types", file: "src/lib.rs", line: 6, column: 5 },
      { severity: "warning", message: "unused variable: `unused`", file: "src/lib.rs", line: 2, column: 9 },
    ]);
    expect(summary).toBeUndefined();
  });

  it("reads cargo test panics with their location and message, and the pass/fail tally", () => {
    const { issues, summary } = parseCheckOutput(cargoTest);
    expect(issues).toEqual([
      { severity: "error", file: "src/lib.rs", line: 6, column: 29, message: "tests::fails_eq: assertion `left == right` failed | left: 3 | right: 4" },
      { severity: "error", file: "src/lib.rs", line: 7, column: 27, message: "tests::panics: boom 42" },
    ]);
    expect(summary).toBe("1 passed, 2 failed");
  });

  it("reads vitest failures with the frame that points at the failing line", () => {
    const { issues, summary } = parseCheckOutput(vitest);
    expect(issues).toEqual([
      { severity: "error", file: "src/zz_fx/a.test.ts", line: 4, column: 40, message: "math > is wrong: AssertionError: expected 2 to be 3 // Object.is equality" },
      { severity: "error", file: "src/zz_fx/a.test.ts", line: 6, column: 28, message: "throws: Error: kaboom" },
    ]);
    expect(summary).toBe("2 failed | 1 passed (3)");
  });

  it("reads pytest failures and takes each line number from its traceback", () => {
    const { issues, summary } = parseCheckOutput(pytestFailures);
    expect(issues).toEqual([
      { severity: "error", file: "test_x.py", line: 5, message: "test_x.py::test_bad: assert (1 + 1) == 3" },
      { severity: "error", file: "test_x.py", line: 8, message: "test_x.py::test_raises: ValueError: nope" },
    ]);
    expect(summary).toBe("2 failed, 1 passed");
  });

  it("reads a pytest collection error, using the E line as its message", () => {
    const { issues } = parseCheckOutput(pytestImportError);
    expect(issues).toEqual([
      { severity: "error", file: "test_i.py", line: 1, message: "test_i.py: ModuleNotFoundError: No module named 'nosuchmodule_xyz'" },
    ]);
  });

  it("reads ruff's concise findings and its count", () => {
    const { issues, summary } = parseCheckOutput(ruff);
    expect(issues.map((issue) => [issue.file, issue.line, issue.column, issue.code, issue.message])).toEqual([
      ["lint_me.py", 1, 8, "F401", "`os` imported but unused"],
      ["lint_me.py", 2, 8, "F401", "`sys` imported but unused"],
      ["lint_me.py", 5, 5, "F841", "Local variable `y` is assigned to but never used"],
    ]);
    expect(summary).toBe("3 errors");
  });

  it("finds nothing in output that has nothing to find", () => {
    expect(parseCheckOutput("")).toEqual({ issues: [], summary: undefined });
    expect(parseCheckOutput("> build\n> vite build\n\nbuilt in 1.2s\n")).toEqual({ issues: [], summary: undefined });
  });
});

describe("parseCheckOutput on documented formats", () => {
  it("reads eslint's stylish output, one file at a time", () => {
    const output = [
      "/repo/src/a.ts",
      "  12:5  error    'x' is assigned a value but never used  @typescript-eslint/no-unused-vars",
      "  14:1  warning  Unexpected console statement            no-console",
      "",
      "/repo/src/b.ts",
      "  3:10  error  Parsing error: Unexpected token",
      "",
      "✖ 3 problems (2 errors, 1 warning)",
    ].join("\n");
    const { issues, summary } = parseCheckOutput(output);
    expect(issues).toEqual([
      { severity: "error", file: "/repo/src/a.ts", line: 12, column: 5, code: "@typescript-eslint/no-unused-vars", message: "'x' is assigned a value but never used" },
      { severity: "warning", file: "/repo/src/a.ts", line: 14, column: 1, code: "no-console", message: "Unexpected console statement" },
      { severity: "error", file: "/repo/src/b.ts", line: 3, column: 10, code: undefined, message: "Parsing error: Unexpected token" },
    ]);
    expect(summary).toBe("3 problems (2 errors, 1 warning)");
  });

  it("reads go build and go test output", () => {
    const output = [
      "# example.com/app",
      "./main.go:10:2: undefined: widget",
      "--- FAIL: TestAdd (0.00s)",
      "    add_test.go:14: got 3, want 4",
      "FAIL\texample.com/app\t0.004s",
      "ok  \texample.com/util\t0.002s",
    ].join("\n");
    const { issues, summary } = parseCheckOutput(output);
    expect(issues).toEqual([
      { severity: "error", file: "main.go", line: 10, column: 2, message: "undefined: widget" },
      { severity: "error", message: "test failed: TestAdd" },
      { severity: "error", file: "add_test.go", line: 14, message: "got 3, want 4" },
    ]);
    expect(summary).toBe("1 package failed");
  });

  it("reads mypy, gcc and javac style lines", () => {
    const output = [
      'app/models.py:12: error: Incompatible types in assignment (expression has type "str", variable has type "int")  [assignment]',
      "src/main.c:3:5: error: unknown type name 'foo'",
      "src/main.c:9:1: warning: unused variable 'y'",
      "Main.java:5: error: cannot find symbol",
    ].join("\n");
    const { issues } = parseCheckOutput(output);
    expect(issues.map((issue) => [issue.severity, issue.file, issue.line, issue.column])).toEqual([
      ["error", "app/models.py", 12, undefined],
      ["error", "src/main.c", 3, 5],
      ["warning", "src/main.c", 9, 1],
      ["error", "Main.java", 5, undefined],
    ]);
  });

  it("reads maven, kotlin and msbuild errors", () => {
    const output = [
      "[ERROR] /repo/src/Main.java:[12,5] cannot find symbol",
      "e: file:///repo/src/App.kt: (7, 3): Unresolved reference: foo",
      "w: file:///repo/src/App.kt: (9, 1): Variable 'z' is never used",
      "Program.cs(14,9): error CS0103: The name 'x' does not exist in the current context [/repo/App.csproj]",
    ].join("\n");
    const { issues } = parseCheckOutput(output);
    expect(issues).toEqual([
      { severity: "error", file: "/repo/src/Main.java", line: 12, column: 5, message: "cannot find symbol" },
      { severity: "error", file: "/repo/src/App.kt", line: 7, column: 3, message: "Unresolved reference: foo" },
      { severity: "warning", file: "/repo/src/App.kt", line: 9, column: 1, message: "Variable 'z' is never used" },
      { severity: "error", file: "Program.cs", line: 14, column: 9, code: "CS0103", message: "The name 'x' does not exist in the current context" },
    ]);
  });

  it("reads tsc --pretty and the jest tally", () => {
    const output = ["src/a.ts:1:14 - error TS2322: Type 'string' is not assignable to type 'number'.", "  ● math › adds", "Tests:       1 failed, 5 passed, 6 total"].join("\n");
    const { issues, summary } = parseCheckOutput(output);
    expect(issues[0]).toMatchObject({ file: "src/a.ts", line: 1, column: 14, code: "TS2322" });
    expect(issues[1]).toMatchObject({ message: "test failed: math › adds" });
    expect(summary).toBe("1 failed, 5 passed, 6 total");
  });

  it("reads newer ruff and rustc arrow-style locations after the header", () => {
    const output = ["F401 [*] `os` imported but unused", " --> lint_me.py:1:8", "  |", "warning: unused import: `Foo`", "  --> src/lib.rs:3:5"].join("\n");
    const { issues } = parseCheckOutput(output);
    expect(issues).toEqual([
      { severity: "error", code: "F401", message: "`os` imported but unused", file: "lint_me.py", line: 1, column: 8 },
      { severity: "warning", code: undefined, message: "unused import: `Foo`", file: "src/lib.rs", line: 3, column: 5 },
    ]);
  });

  it("reads the older cargo panic format and a test that failed without a panic line", () => {
    const output = ["test a::b ... FAILED", "test c::d ... FAILED", "thread 'a::b' panicked at 'bad thing', src/lib.rs:9:5"].join("\n");
    const { issues } = parseCheckOutput(output);
    expect(issues).toEqual([
      { severity: "error", file: "src/lib.rs", line: 9, column: 5, message: "a::b: bad thing" },
      { severity: "error", message: "test failed: c::d" },
    ]);
  });

  it("strips colour codes before reading, and lists a repeated error once", () => {
    const output = "\u001b[31msrc/a.ts(1,1): error TS1005: ';' expected.\u001b[0m\nsrc/a.ts(1,1): error TS1005: ';' expected.";
    expect(parseCheckOutput(output).issues).toHaveLength(1);
    expect(stripAnsi("\u001b[1;32mok\u001b[0m")).toBe("ok");
  });

  it("clips a very long message", () => {
    const long = "x".repeat(2000);
    const [issue] = parseCheckOutput(`src/a.ts(1,1): error TS1: ${long}`).issues;
    expect(issue.message.length).toBeLessThanOrEqual(300);
    expect(issue.message.endsWith("…")).toBe(true);
  });
});

describe("classifyFailure", () => {
  const base: FailureInput = { exitCode: 1, timedOut: false, cancelled: false, output: "", installNeeded: false };

  it("calls compiler and test failures code problems", () => {
    for (const output of [tsc, cargoCheck, cargoTest, vitest, pytestFailures, ruff]) {
      expect(classifyFailure({ ...base, output })).toEqual({ kind: "code", hint: "" });
    }
  });

  it("recognizes a missing tool, and blames uninstalled dependencies when they are known to be missing", () => {
    const real = { ...base, exitCode: 127, output: npmMissingTool };
    expect(classifyFailure({ ...real, installNeeded: true })).toMatchObject({ kind: "dependencies", hint: expect.stringContaining("Call install_dependencies first") });
    expect(classifyFailure({ ...real, installNeeded: false })).toMatchObject({ kind: "missing-tool" });
    expect(classifyFailure({ ...base, output: "'tsc' is not recognized as an internal or external command" })).toMatchObject({ kind: "missing-tool" });
    expect(classifyFailure({ ...base, output: "Error: spawn npm ENOENT" })).toMatchObject({ kind: "missing-tool" });
  });

  it("recognizes a script that does not exist and a missing manifest", () => {
    expect(classifyFailure({ ...base, output: npmMissingScript })).toMatchObject({ kind: "missing-script", hint: expect.stringContaining("'nothere'") });
    expect(classifyFailure({ ...base, exitCode: 101, output: cargoNoManifest })).toMatchObject({ kind: "missing-manifest" });
  });

  it("does not call an unresolved package an environment problem unless dependencies are known missing", () => {
    const output = pytestImportError;
    expect(classifyFailure({ ...base, output, installNeeded: true })).toMatchObject({ kind: "dependencies" });
    const notKnown = classifyFailure({ ...base, output, installNeeded: false });
    expect(notKnown.kind).toBe("code");
    expect(notKnown.hint).toMatch(/never added|out of date/);
    const ts = "src/a.ts(3,22): error TS2307: Cannot find module 'left-pad' or its corresponding type declarations.";
    expect(classifyFailure({ ...base, output: ts }).kind).toBe("code");
    expect(classifyFailure({ ...base, output: ts, installNeeded: true }).kind).toBe("dependencies");
  });

  it("does not mistake a relative import for a missing package", () => {
    const output = "src/a.ts(3,22): error TS2307: Cannot find module './missing' or its corresponding type declarations.";
    expect(classifyFailure({ ...base, output, installNeeded: true })).toEqual({ kind: "code", hint: "" });
  });

  it("reports timeouts, cancellation and a program that could not start ahead of anything in the output", () => {
    expect(classifyFailure({ ...base, timedOut: true, output: tsc }).kind).toBe("timeout");
    expect(classifyFailure({ ...base, cancelled: true, timedOut: true }).kind).toBe("cancelled");
    expect(classifyFailure({ ...base, exitCode: null, startError: "No such file or directory", program: "cargo" })).toMatchObject({
      kind: "missing-tool",
      hint: expect.stringContaining("'cargo'"),
    });
  });
});

describe("parseCheckOutput: how many tests ran", () => {
  const ran = (output: string) => parseCheckOutput(output).testsRun;

  it("counts the tests a run executed, for the tallies that say so", () => {
    expect(ran(cargoTestMatch)).toBe(1);
    expect(ran(vitestNameMatch)).toBe(1);
    expect(ran(pytestMatch)).toBe(1);
    expect(ran(vitest)).toBeGreaterThan(0);
    expect(ran(pytestFailures)).toBeGreaterThan(0);
    expect(ran(cargoTest)).toBeGreaterThan(0);
  });

  it("says zero when a filter matched nothing, in each runner's own words", () => {
    expect(ran(cargoTestNoMatch)).toBe(0); // "0 passed; 0 failed ... filtered out", for every test binary
    expect(ran(vitestNameNoMatch)).toBe(0); // "Tests  16 skipped (16)", and the exit status is 0
    expect(ran(vitestFileNoMatch)).toBe(0); // "No test files found"
    expect(ran(pytestNoMatch)).toBe(0); // "2 deselected"
    expect(ran(pytestFileNoMatch)).toBe(0); // "no tests ran"
  });

  it("reads jest's tally and go's per-package lines", () => {
    expect(ran("Test Suites: 1 passed, 1 total\nTests:       2 passed, 1 skipped, 3 total\n")).toBe(2);
    expect(ran("Test Suites: 1 skipped, 1 total\nTests:       3 skipped, 3 total\n")).toBe(0);
    expect(ran("No tests found, exiting with code 1\n")).toBe(0);
    expect(ran("ok  \texample.com/m/parser\t0.012s\n?   \texample.com/m/cmd\t[no test files]\n")).toBe(1);
    expect(ran("ok  \texample.com/m/parser\t0.002s [no tests to run]\n?   \texample.com/m/cmd\t[no test files]\n")).toBe(0);
    expect(ran("FAIL\texample.com/m/parser\t0.010s\nFAIL\n")).toBe(1);
  });

  it("stays unknown when the run broke before any test started, so a broken run is never mistaken for a filter that matched nothing", () => {
    expect(ran(tsc)).toBeUndefined();
    expect(ran(cargoCheck)).toBeUndefined();
    expect(ran(pytestImportError)).toBeGreaterThan(0); // a collection error counts: it is a failure to report
    expect(ran("")).toBeUndefined();
    // jest prints "0 total" when a suite could not even be loaded
    expect(ran("Test Suites: 1 failed, 1 total\nTests:       0 total\n")).toBeUndefined();
    // a go package that did not build, next to one with no tests
    expect(ran("FAIL\texample.com/m/a [build failed]\nok  \texample.com/m/b\t0.002s [no tests to run]\n")).toBeUndefined();
    // vitest could not load a file: "no tests", not a skipped filter
    expect(ran(" Test Files  1 failed (1)\n      Tests  no tests\n")).toBeUndefined();
  });
});
