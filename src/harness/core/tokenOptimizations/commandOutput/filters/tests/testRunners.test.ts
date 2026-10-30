import { describe, expect, it } from "vitest";
import cargoTest from "../../../../__fixtures__/checks/cargo_test.txt?raw";
import pytest from "../../../../__fixtures__/checks/pytest.txt?raw";
import vitest from "../../../../__fixtures__/checks/vitest.txt?raw";
import { toInvocation } from "../../invocation";
import { isTestRun, testRunFilter } from "./testRunners";

const apply = (program: string, args: string[], output: string) => testRunFilter.apply(output, toInvocation(program, args, 1))!;

describe("test runs", () => {
  it("recognises test commands through package scripts and wrappers", () => {
    for (const [program, args] of [["cargo", ["test"]], ["npm", ["test"]], ["pnpm", ["run", "test:unit"]], ["npx", ["vitest", "run"]], ["python", ["-m", "pytest"]], ["uv", ["run", "pytest"]], ["go", ["test", "./..."]], ["dotnet", ["test"]]] as const) {
      expect(isTestRun(toInvocation(program, [...args], 0))).toBe(true);
    }
    expect(isTestRun(toInvocation("npm", ["run", "build"], 0))).toBe(false);
    expect(isTestRun(toInvocation("cargo", ["build"], 0))).toBe(false);
  });

  it("keeps cargo failures, panics and the tally and drops passing tests and compile lines", () => {
    const out = apply("cargo", ["test"], cargoTest);
    expect(out).not.toContain("test tests::adds ... ok");
    expect(out).toContain("   Compiling 1 crate");
    for (const kept of ["test tests::fails_eq ... FAILED", "assertion `left == right` failed", "boom 42", "test result: FAILED. 1 passed; 2 failed"]) expect(out).toContain(kept);
  });

  it("drops test binaries that ran nothing", () => {
    const out = apply("cargo", ["test"], [
      "     Running unittests src/lib.rs (target/debug/deps/a-1)",
      "",
      "running 0 tests",
      "",
      "test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s",
      "",
      "     Running tests/api.rs (target/debug/deps/api-2)",
      "",
      "running 1 test",
      "test api_works ... ok",
      "",
      "test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.01s",
    ].join("\n"));
    expect(out).not.toContain("unittests src/lib.rs");
    expect(out).not.toContain("api_works ... ok");
    expect(out).toContain("Running tests/api.rs");
    expect(out).toContain("test result: ok. 1 passed");
  });

  it("keeps vitest and pytest failures with their details", () => {
    const fromVitest = apply("npx", ["vitest", "run"], `${vitest}\n ✓ src/ok.test.ts (12 tests) 4ms\n`);
    expect(fromVitest).not.toContain("✓ src/ok.test.ts");
    expect(fromVitest).toContain("AssertionError: expected 2 to be 3");
    const fromPytest = apply("pytest", ["-v"], `tests/test_a.py::test_ok PASSED [ 50%]\n${pytest}`);
    expect(fromPytest).not.toContain("test_ok PASSED");
    expect(fromPytest).toContain("FAILED");
  });

  it("drops go's per-test chatter and keeps failures and package results", () => {
    const out = apply("go", ["test", "-v", "./..."], "=== RUN   TestA\n--- PASS: TestA (0.00s)\n=== RUN   TestB\n    b_test.go:9: want 1, got 2\n--- FAIL: TestB (0.00s)\nFAIL\nFAIL\texample.com/b\t0.01s\nok  \texample.com/a\t0.01s");
    expect(out.split("\n")).toEqual(["    b_test.go:9: want 1, got 2", "--- FAIL: TestB (0.00s)", "FAIL", "FAIL\texample.com/b\t0.01s", "ok  \texample.com/a\t0.01s"]);
  });
});
