import { describe, expect, it } from "vitest";

import type { Check } from "./projectInfo";
import { describeSelector, narrowTestCheck, parseSelector, type TestSelector } from "./testFilter";

const check = (overrides: Partial<Check>): Check => ({ id: "test", program: "npm", args: ["run", "test"], cwd: ".", source: "x", ...overrides });

/** The arguments the runner would get, or the failure kind. */
const argsFor = (command: Check, selector: TestSelector) => {
  const result = narrowTestCheck(command, selector);
  return result.ok ? [result.check.program, ...result.check.args] : result.kind;
};

describe("parseSelector", () => {
  it("reads a name and a file, tidying the path", () => {
    expect(parseSelector("  adds two ", ".\\src\\a.test.ts")).toEqual({ ok: true, selector: { name: "adds two", file: "src/a.test.ts" } });
    expect(parseSelector(undefined, undefined)).toEqual({ ok: true, selector: {} });
    expect(parseSelector("", "  ")).toEqual({ ok: true, selector: {} });
  });

  it("refuses anything a runner would read as its own option, or that leaves the project", () => {
    for (const bad of ["-u", "--config=evil.js", "-t"]) {
      expect(parseSelector(bad, undefined).ok, bad).toBe(false);
      expect(parseSelector(undefined, bad).ok, bad).toBe(false);
    }
    for (const bad of ["/etc/passwd", "C:\\Windows\\x.test.ts", "../other/x.test.ts", "src/../../x.test.ts"]) {
      expect(parseSelector(undefined, bad).ok, bad).toBe(false);
    }
    expect(parseSelector("a\nb", undefined).ok).toBe(false);
    expect(parseSelector("x".repeat(301), undefined).ok).toBe(false);
    expect(parseSelector(42, undefined)).toEqual({ ok: false, error: "test_name must be a string." });
  });

  it("describes what a run was narrowed to", () => {
    expect(describeSelector({ name: "adds" })).toBe('test_name "adds"');
    expect(describeSelector({ name: "adds", file: "a.test.ts" })).toBe('test_name "adds" and test_file "a.test.ts"');
  });
});

describe("narrowTestCheck", () => {
  it("changes nothing when there is nothing to narrow to", () => {
    const original = check({ runner: "vitest" });
    expect(narrowTestCheck(original, {})).toEqual({ ok: true, check: original });
  });

  describe("vitest and jest", () => {
    it("passes a file as a path and a name as -t, through npm's --", () => {
      const vitest = check({ runner: "vitest" });
      expect(argsFor(vitest, { file: "src/a.test.ts" })).toEqual(["npm", "run", "test", "--", "src/a.test.ts"]);
      expect(argsFor(vitest, { name: "adds two" })).toEqual(["npm", "run", "test", "--", "-t", "adds two"]);
      expect(argsFor(check({ runner: "jest" }), { file: "src/a.test.ts", name: "adds" })).toEqual(["npm", "run", "test", "--", "src/a.test.ts", "-t", "adds"]);
    });

    it("adds to arguments the detection already forwarded, without a second --", () => {
      const watching = check({ runner: "vitest", args: ["run", "test", "--", "--run"] });
      expect(argsFor(watching, { name: "x" })).toEqual(["npm", "run", "test", "--", "--run", "-t", "x"]);
    });

    it("does not use -- for the other package managers", () => {
      expect(argsFor(check({ runner: "vitest", program: "pnpm" }), { name: "x" })).toEqual(["pnpm", "run", "test", "-t", "x"]);
      expect(argsFor(check({ runner: "vitest", program: "yarn" }), { file: "a.test.ts" })).toEqual(["yarn", "run", "test", "a.test.ts"]);
    });

    it("treats the name as plain text, because the runner reads it as a pattern", () => {
      expect(argsFor(check({ runner: "vitest" }), { name: "parses (a|b) [x] 1+1=2?" })).toEqual(["npm", "run", "test", "--", "-t", "parses \\(a\\|b\\) \\[x\\] 1\\+1=2\\?"]);
    });

    it("drops the project's folder from a workspace-relative file, and leaves a project-relative one alone", () => {
      const web = check({ runner: "vitest", cwd: "apps/web" });
      expect(argsFor(web, { file: "apps/web/src/a.test.ts" })).toEqual(["npm", "run", "test", "--", "src/a.test.ts"]);
      expect(argsFor(web, { file: "src/a.test.ts" })).toEqual(["npm", "run", "test", "--", "src/a.test.ts"]);
    });

    it("leaves a file of another language to the command that can run it", () => {
      expect(argsFor(check({ runner: "vitest" }), { file: "src-tauri/src/lib.rs" })).toBe("inapplicable");
    });
  });

  describe("pytest", () => {
    const pytest = check({ program: "python", args: ["-m", "pytest"], runner: "pytest" });

    it("uses -k for a function name and a path for a file", () => {
      expect(argsFor(pytest, { name: "test_adds" })).toEqual(["python", "-m", "pytest", "-k", "test_adds"]);
      expect(argsFor(pytest, { file: "tests/test_math.py" })).toEqual(["python", "-m", "pytest", "tests/test_math.py"]);
      expect(argsFor(pytest, { file: "tests/test_math.py", name: "test_adds" })).toEqual(["python", "-m", "pytest", "tests/test_math.py", "-k", "test_adds"]);
    });

    it("takes a node id as a path, and works behind uv or poetry", () => {
      expect(argsFor(pytest, { name: "tests/test_math.py::test_adds" })).toEqual(["python", "-m", "pytest", "tests/test_math.py::test_adds"]);
      expect(argsFor(check({ program: "uv", args: ["run", "pytest"], runner: "pytest" }), { name: "test_adds" })).toEqual(["uv", "run", "pytest", "-k", "test_adds"]);
    });

    it("refuses a name -k cannot express, saying what to give instead", () => {
      const result = narrowTestCheck(pytest, { name: "adds two numbers" });
      expect(result).toMatchObject({ ok: false, kind: "invalid" });
      expect(result.ok ? "" : result.error).toContain("test_parses_empty_input");
      expect(argsFor(pytest, { name: "tests/a.py::t", file: "tests/a.py" })).toBe("invalid");
    });
  });

  describe("cargo", () => {
    const cargo = check({ program: "cargo", args: ["test", "--workspace"], runner: "cargo", cwd: "src-tauri" });

    it("puts the name after the flags the detection already has", () => {
      expect(argsFor(cargo, { name: "parser::tests::empty_input" })).toEqual(["cargo", "test", "--workspace", "parser::tests::empty_input"]);
    });

    it("runs an integration test file with --test, and says a source file cannot be selected", () => {
      expect(argsFor(cargo, { file: "src-tauri/tests/api.rs" })).toEqual(["cargo", "test", "--workspace", "--test", "api"]);
      expect(argsFor(cargo, { file: "tests/api.rs", name: "adds" })).toEqual(["cargo", "test", "--workspace", "--test", "api", "adds"]);
      const result = narrowTestCheck(cargo, { file: "src/lib.rs" });
      expect(result).toMatchObject({ ok: false, kind: "invalid" });
      expect(result.ok ? "" : result.error).toContain("test_name");
      expect(argsFor(cargo, { file: "src/a.test.ts" })).toBe("inapplicable");
    });
  });

  describe("go", () => {
    const go = check({ program: "go", args: ["test", "./..."], runner: "go" });

    it("uses -run for a name and narrows the package for a file", () => {
      expect(argsFor(go, { name: "TestParse/empty" })).toEqual(["go", "test", "-run", "TestParse/empty", "./..."]);
      expect(argsFor(go, { file: "internal/parser/parser_test.go" })).toEqual(["go", "test", "./internal/parser"]);
      expect(argsFor(go, { file: "main_test.go", name: "TestMain" })).toEqual(["go", "test", "-run", "TestMain", "."]);
      expect(argsFor(go, { file: "src/a.test.ts" })).toBe("inapplicable");
    });
  });

  it("says plainly that a runner it does not know cannot be narrowed, and what to do instead", () => {
    for (const unknown of [check({}), check({ program: "mvn", args: ["test"] }), check({ runner: undefined, program: "dotnet", args: ["test"] })]) {
      const result = narrowTestCheck(unknown, { name: "x" });
      expect(result).toMatchObject({ ok: false, kind: "unsupported" });
      expect(result.ok ? "" : result.error).toMatch(/vitest, jest, pytest, cargo test and go test.*run_command/);
    }
  });
});
