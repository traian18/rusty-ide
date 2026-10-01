import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";

import type { RunHost } from "../../contract";
import { CHECK_IDS, INSTALL_DEPENDENCIES_TOOL, RUN_CHECK_TOOL, installDependenciesTool, runCheckTool } from "./runCheckTool";

import cargoCheck from "../__fixtures__/checks/cargo_check.txt?raw";
import cargoTestMatch from "../__fixtures__/checks/cargo_test_match.txt?raw";
import cargoTestNoMatch from "../__fixtures__/checks/cargo_test_nomatch.txt?raw";
import npmMissingTool from "../__fixtures__/checks/npm_missing_tool.txt?raw";
import pytestMatch from "../__fixtures__/checks/pytest_match.txt?raw";
import tsc from "../__fixtures__/checks/tsc.txt?raw";
import vitestNameMatch from "../__fixtures__/checks/vitest_name_match.txt?raw";
import vitestNameNoMatch from "../__fixtures__/checks/vitest_name_nomatch.txt?raw";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

const invokeMock = vi.mocked(invoke);
const signal = new AbortController().signal;

interface Run {
  exit_code: number | null;
  output: string;
  timed_out: boolean;
}
const ok = (output = ""): Run => ({ exit_code: 0, output, timed_out: false });

type Tree = Record<string, string>;
const json = JSON.stringify;

/** The nested listing `list_directory` would return for `tree`. */
function listingFor(tree: Tree) {
  interface Node { name: string; path: string; is_dir: boolean; children?: Node[] }
  const root: Node = { name: "", path: "/ws", is_dir: true, children: [] };
  for (const file of Object.keys(tree)) {
    let current = root;
    const parts = file.split("/");
    parts.forEach((part, index) => {
      const isFile = index === parts.length - 1;
      let next = current.children?.find((child) => child.name === part);
      if (!next) {
        next = { name: part, path: `${current.path}/${part}`, is_dir: !isFile, children: isFile ? undefined : [] };
        current.children?.push(next);
      }
      current = next;
    });
  }
  return { entries: root.children, truncated: false };
}

function setup(tree: Tree, runs: (Run | Error)[], options: { exists?: string[]; decisions?: string[] } = {}) {
  const existing = new Set(options.exists ?? []);
  const executed: Record<string, unknown>[] = [];
  const queue = [...runs];
  invokeMock.mockImplementation(async (command: string, args?: unknown) => {
    const a = args as Record<string, unknown>;
    if (command === "list_directory") return listingFor(tree);
    if (command === "check_external_path") return { exists: existing.has(a.path as string) };
    if (command === "run_shell_command") {
      executed.push(a);
      const next = queue.shift() ?? ok();
      if (next instanceof Error) throw next;
      return next;
    }
    throw new Error(`unexpected command ${command}`);
  });
  const decisions = [...(options.decisions ?? [])];
  const requestPermission = vi.fn(async () => (decisions.shift() ?? "allow_once") as "allow_once" | "deny");
  const host = {
    readFile: vi.fn(async (path: string) => {
      const relative = path.replace(/^\/ws\//, "");
      if (!(relative in tree)) throw new Error(`File not found: ${path}`);
      return tree[relative];
    }),
    writeFile: vi.fn(),
    requestPermission,
  } as unknown as RunHost;
  const onEvent = vi.fn();
  const toolOptions = { workspaceRoot: "/ws", sessionId: "tab-1", host, onEvent };
  const tool = runCheckTool(toolOptions);
  const install = installDependenciesTool(toolOptions);
  return { tool, install, executed, requestPermission, onEvent };
}

const ide: Tree = { "ide/package.json": json({ scripts: { typecheck: "tsc --noEmit", test: "vitest run" } }) };

describe("runCheckTool", () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  it("runs the detected command after asking the user, and reports a failure as a failed tool call with the errors", async () => {
    const { tool, executed, requestPermission } = setup(ide, [{ exit_code: 2, output: tsc, timed_out: false }]);
    const outcome = await tool({ check: "typecheck" }, signal);

    expect(requestPermission).toHaveBeenCalledTimes(1);
    expect(requestPermission).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: "tab-1",
        command: expect.objectContaining({ program: "npm", args: ["run", "typecheck"], cwd: "/ws/ide" }),
        description: "The agent wants to run the project's typecheck check: npm run typecheck",
      }),
      signal,
    );
    expect(executed).toEqual([expect.objectContaining({ program: "npm", args: ["run", "typecheck"], cwd: "/ws/ide", timeoutMs: 300_000 })]);

    expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error("expected a failure");
    expect(outcome.error.startsWith("typecheck for ide: FAILED")).toBe(true);
    expect(outcome.error).toContain("[1/1] npm run typecheck (cwd: ide): FAILED (exit 2)");
    expect(outcome.error).toContain("- src/a.ts:1:14 [TS2322] Type 'string' is not assignable to type 'number'.");
    expect(outcome.error).toContain("3 errors:");
  });

  it("reports a pass as a successful tool call", async () => {
    const { tool } = setup(ide, [ok("done")]);
    const outcome = await tool({ check: "typecheck" }, signal);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) throw new Error("expected ok");
    expect(outcome.output.startsWith("typecheck for ide: PASSED")).toBe(true);
    expect(outcome.output).toContain("Overall: PASSED");
  });

  it("decides from the exit status, not from what the output says", async () => {
    const failing = await setup(ide, [{ exit_code: 1, output: "0 errors, all good", timed_out: false }]).tool({ check: "typecheck" }, signal);
    expect(failing.ok).toBe(false);
    const passing = await setup(ide, [ok("error: 3 errors found")]).tool({ check: "typecheck" }, signal);
    expect(passing.ok).toBe(true);
  });

  describe("a project with several commands for one check", () => {
    const tauri: Tree = {
      "app/package.json": json({ scripts: { typecheck: "tsc --noEmit", tauri: "tauri" } }),
      "app/src-tauri/Cargo.toml": '[package]\nname = "app"\n',
      "app/src-tauri/tauri.conf.json": "{}",
    };

    it("runs each, asking for each, in the folder it belongs to, and reports the one that failed", async () => {
      const { tool, executed, requestPermission } = setup(tauri, [ok(), { exit_code: 101, output: cargoCheck, timed_out: false }]);
      const outcome = await tool({ check: "typecheck" }, signal);

      expect(requestPermission).toHaveBeenCalledTimes(2);
      expect(requestPermission.mock.calls.map(([request]) => (request as { description: string }).description)).toEqual([
        "The agent wants to run the project's typecheck check (1 of 2): npm run typecheck",
        "The agent wants to run the project's typecheck check (2 of 2): cargo check",
      ]);
      expect(executed.map((call) => [call.program, call.cwd])).toEqual([["npm", "/ws/app"], ["cargo", "/ws/app/src-tauri"]]);
      if (outcome.ok) throw new Error("expected a failure");
      expect(outcome.error).toContain("[1/2] npm run typecheck (cwd: app): passed");
      expect(outcome.error).toContain("[2/2] cargo check (cwd: app/src-tauri): FAILED (exit 101)");
      expect(outcome.error).toContain("- src/lib.rs:6:5 [E0308] mismatched types");
      expect(outcome.error).toContain("Overall: FAILED (1 of 2 commands failed).");
    });

    it("keeps what already ran when the user declines the next command", async () => {
      const { tool, executed } = setup(tauri, [ok()], { decisions: ["allow_once", "deny"] });
      const outcome = await tool({ check: "typecheck" }, signal);
      expect(executed).toHaveLength(1);
      if (outcome.ok) throw new Error("expected a failure");
      expect(outcome.error).toContain("[1/1] npm run typecheck (cwd: app): passed");
      expect(outcome.error).toContain("Stopped: Command denied by the user. `cargo check` was not run, so this check is incomplete and proves nothing.");
    });
  });

  it("runs nothing and says so when the user declines the first command", async () => {
    const { tool, executed } = setup(ide, [], { decisions: ["deny"] });
    expect(await tool({ check: "typecheck" }, signal)).toEqual({
      ok: false,
      error: "Stopped: Command denied by the user. `npm run typecheck` was not run, so this check is incomplete and proves nothing.",
    });
    expect(executed).toEqual([]);
  });

  describe("choosing the project", () => {
    const two: Tree = { ...ide, "svc/package.json": json({ scripts: { test: "vitest run" } }) };

    it("asks for a path rather than guessing, without running or asking anything", async () => {
      const { tool, executed, requestPermission } = setup(two, []);
      expect(await tool({ check: "test" }, signal)).toEqual({ ok: false, error: "Several projects have a test check: ide, svc. Call run_check again with path set to one of them." });
      expect(executed).toEqual([]);
      expect(requestPermission).not.toHaveBeenCalled();
    });

    it("runs the one named by path, or containing it", async () => {
      for (const path of ["svc", "svc/src/deep"]) {
        const { tool, executed } = setup(two, [ok()]);
        const outcome = await tool({ check: "test", path }, signal);
        expect(outcome.ok).toBe(true);
        expect(executed[0]).toMatchObject({ cwd: "/ws/svc" });
      }
    });

    it("says what exists when the check does not", async () => {
      const { tool } = setup(ide, []);
      const outcome = await tool({ check: "build" }, signal);
      expect(outcome).toEqual({ ok: false, error: expect.stringContaining("No build check was detected for ide. Detected checks: ide: typecheck, test.") });
    });
  });

  describe("telling a code problem from an environment problem", () => {
    const needsInstall: Tree = { "ide/package.json": json({ scripts: { typecheck: "tsc --noEmit" }, dependencies: { typescript: "5" } }) };

    it("says dependencies are not installed, ahead of the output, when the tool is missing and node_modules is too", async () => {
      const { tool } = setup(needsInstall, [{ exit_code: 127, output: npmMissingTool, timed_out: false }]);
      const outcome = await tool({ check: "typecheck" }, signal);
      if (outcome.ok) throw new Error("expected a failure");
      expect(outcome.error).toContain("Cause (not a code problem): A tool the check needs is missing because the project's dependencies are not installed.");
      expect(outcome.error).toContain("sh: tsc: command not found");
      expect(outcome.error).toMatch(/Call install_dependencies first, then run the check again/);
      expect(outcome.error).not.toContain("Fix the errors listed above");
    });

    it("installs through install_dependencies, which asks in its own words and reports like a check", async () => {
      const { install, executed, requestPermission } = setup(needsInstall, [ok("added 5 packages")]);
      const outcome = await install(undefined, signal);
      expect(outcome.ok).toBe(true);
      if (!outcome.ok) throw new Error("expected ok");
      expect(outcome.output.startsWith("install for ide: PASSED")).toBe(true);
      expect(executed[0]).toMatchObject({ program: "npm", args: ["install"], cwd: "/ws/ide", timeoutMs: 600_000 });
      expect(requestPermission).toHaveBeenCalledWith(expect.objectContaining({ description: "The agent wants to install the project's dependencies: npm install" }), signal);
    });

    it("keeps installing out of run_check, so an install can never stand in for having checked", async () => {
      const { tool, executed, requestPermission } = setup(needsInstall, []);
      expect(await tool({ check: "install" }, signal)).toEqual({
        ok: false,
        error: "run_check only verifies the project. To install its dependencies call install_dependencies.",
      });
      expect(executed).toEqual([]);
      expect(requestPermission).not.toHaveBeenCalled();
    });

    it("explains a refused install without calling it an incomplete check", async () => {
      const { install } = setup(needsInstall, [], { decisions: ["deny"] });
      expect(await install({}, signal)).toEqual({
        ok: false,
        error: "Stopped: Command denied by the user. `npm install` was not run, so nothing was installed.",
      });
    });

    it("reports a failed install, with the cause", async () => {
      const { install } = setup(needsInstall, [{ exit_code: 1, output: "npm error network request failed", timed_out: false }]);
      const outcome = await install({}, signal);
      if (outcome.ok) throw new Error("expected a failure");
      expect(outcome.error).toContain("install for ide: FAILED");
      expect(outcome.error).toContain("npm error network request failed");
    });

    it("does not blame the environment for the same failure when dependencies are installed", async () => {
      const { tool } = setup(needsInstall, [{ exit_code: 127, output: npmMissingTool, timed_out: false }], { exists: ["/ws/ide/node_modules"] });
      const outcome = await tool({ check: "typecheck" }, signal);
      if (outcome.ok) throw new Error("expected a failure");
      expect(outcome.error).toContain("A program the check needs is not installed or not on PATH.");
      expect(outcome.error).not.toContain("dependencies are not installed");
    });

    it("refuses an install when nothing needs installing", async () => {
      const { install, executed } = setup(needsInstall, [], { exists: ["/ws/ide/node_modules"] });
      expect(await install({}, signal)).toEqual({ ok: false, error: "Nothing to install: dependencies already appear to be installed for ide." });
      expect(executed).toEqual([]);
    });
  });

  describe("when the command does not finish normally", () => {
    it("reports a timeout and how to allow more time", async () => {
      const { tool } = setup(ide, [{ exit_code: null, output: "partial output", timed_out: true }]);
      const outcome = await tool({ check: "typecheck" }, signal);
      if (outcome.ok) throw new Error("expected a failure");
      expect(outcome.error).toContain("FAILED: timed out after");
      expect(outcome.error).toContain("timeout_seconds");
    });

    it("uses a per-check default timeout and clamps the one the model asks for", async () => {
      const used = async (extra: Record<string, unknown>, check = "typecheck") => {
        const { tool, executed } = setup(ide, [ok()]);
        await tool({ check, ...extra }, signal);
        return executed[0].timeoutMs;
      };
      expect(await used({})).toBe(300_000);
      expect(await used({}, "test")).toBe(600_000);
      expect(await used({ timeout_seconds: 30 })).toBe(30_000);
      expect(await used({ timeout_seconds: 99_999 })).toBe(1_800_000);
      expect(await used({ timeout_seconds: "soon" })).toBe(300_000);
    });

    it("reports a program that could not be started as a missing tool, not a code error", async () => {
      const { tool } = setup(ide, [new Error("No such file or directory (os error 2)")]);
      const outcome = await tool({ check: "typecheck" }, signal);
      if (outcome.ok) throw new Error("expected a failure");
      expect(outcome.error).toContain("FAILED: could not be started");
      expect(outcome.error).toContain("The program 'npm' could not be started");
    });

    it("reports a cancelled run as cancelled", async () => {
      const { tool } = setup(ide, [{ exit_code: null, output: "", timed_out: false, ...({ cancelled: true } as object) } as Run]);
      const outcome = await tool({ check: "typecheck" }, signal);
      if (outcome.ok) throw new Error("expected a failure");
      expect(outcome.error).toContain("CANCELLED");
    });
  });

  describe("bad requests", () => {
    it("rejects an unknown or missing check before touching the disk", async () => {
      const { tool, executed } = setup(ide, []);
      for (const check of ["deploy", "", undefined, 5]) {
        expect(await tool({ check }, signal)).toEqual({ ok: false, error: `check must be one of: ${CHECK_IDS.join(", ")}.` });
      }
      expect(await tool(undefined, signal)).toMatchObject({ ok: false });
      expect(executed).toEqual([]);
      expect(invokeMock).not.toHaveBeenCalled();
    });

    it("accepts the check name in any case", async () => {
      expect((await setup(ide, [ok()]).tool({ check: " TypeCheck " }, signal)).ok).toBe(true);
    });

    it("reports a workspace that cannot be scanned, and no workspace at all", async () => {
      invokeMock.mockRejectedValue("Directory does not exist");
      const host = { readFile: vi.fn(), requestPermission: vi.fn() } as unknown as RunHost;
      const failing = runCheckTool({ workspaceRoot: "/ws", sessionId: "t", host, onEvent: vi.fn() });
      expect(await failing({ check: "test" }, signal)).toEqual({ ok: false, error: "Directory does not exist" });
      const none = runCheckTool({ workspaceRoot: "  ", sessionId: "t", host, onEvent: vi.fn() });
      expect(await none({ check: "test" }, signal)).toEqual({ ok: false, error: expect.stringContaining("No workspace is open") });
    });
  });
});

describe("INSTALL_DEPENDENCIES_TOOL", () => {
  it("takes only an optional path and timeout, and says it is not a check", () => {
    expect(INSTALL_DEPENDENCIES_TOOL.name).toBe("install_dependencies");
    expect(INSTALL_DEPENDENCIES_TOOL.input_schema.required).toEqual([]);
    expect(Object.keys(INSTALL_DEPENDENCIES_TOOL.input_schema.properties as object)).toEqual(["path", "timeout_seconds"]);
    expect(INSTALL_DEPENDENCIES_TOOL.description).toMatch(/not a check and proves nothing about the code/);
  });
});

describe("running one test", () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  const web: Tree = { "web/package.json": json({ scripts: { test: "vitest run", typecheck: "tsc --noEmit" } }) };
  // A Tauri app: vitest for the frontend, cargo test for the backend, in one project.
  const tauri: Tree = {
    "app/package.json": json({ scripts: { test: "vitest run", tauri: "tauri" } }),
    "app/src-tauri/Cargo.toml": '[package]\nname = "app"\n',
    "app/src-tauri/tauri.conf.json": "{}",
  };
  const asked = (requestPermission: ReturnType<typeof setup>["requestPermission"]) =>
    requestPermission.mock.calls.map(([request]) => (request as { description: string }).description);

  it("runs only the named test through the script, says so in the approval and in the report, and passes when it ran and passed", async () => {
    const { tool, executed, requestPermission } = setup(web, [ok(vitestNameMatch)]);
    const outcome = await tool({ check: "test", test_name: "orders checks" }, signal);

    expect(executed).toEqual([expect.objectContaining({ program: "npm", args: ["run", "test", "--", "-t", "orders checks"], cwd: "/ws/web" })]);
    expect(asked(requestPermission)).toEqual([`The agent wants to run the project's test check (only test_name "orders checks"): npm run test -- -t orders checks`]);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) throw new Error("expected ok");
    expect(outcome.output.startsWith('test for web (only test_name "orders checks"): PASSED')).toBe(true);
    expect(outcome.output).toContain("Result: 1 passed | 49 skipped (50)");
  });

  it("fails a filter that matched nothing even though the runner exited 0", async () => {
    const { tool } = setup(web, [ok(vitestNameNoMatch)]);
    const outcome = await tool({ check: "test", test_name: "zzznomatch" }, signal);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error("expected a failure");
    expect(outcome.error.startsWith('test for web (only test_name "zzznomatch"): FAILED')).toBe(true);
    expect(outcome.error).toContain("Nothing was checked");
  });

  it("runs a file through the project's own runner, relative to the project", async () => {
    const { tool, executed } = setup(web, [ok(vitestNameMatch)]);
    await tool({ check: "test", test_file: "web/src/a.test.ts" }, signal);
    expect(executed).toEqual([expect.objectContaining({ args: ["run", "test", "--", "src/a.test.ts"] })]);
  });

  it("asks nothing and runs nothing when the request cannot be met, and says why", async () => {
    const cases: [Record<string, unknown>, Tree, RegExp][] = [
      [{ check: "typecheck", test_name: "x" }, web, /only apply to check: test/],
      [{ check: "test", test_name: "--config=evil.js" }, web, /cannot start with "-"/],
      [{ check: "test", test_file: "../outside.test.ts" }, web, /inside the workspace/],
      [{ check: "test", test_name: "x" }, { "web/package.json": json({ scripts: { test: "mocha" } }) }, /vitest, jest, pytest, cargo test and go test/],
      [{ check: "test", test_file: "src/lib.rs" }, { "Cargo.toml": '[package]\nname = "x"\n' }, /selects unit tests by name/],
    ];
    for (const [args, tree, expected] of cases) {
      const { tool, executed, requestPermission } = setup(tree, []);
      const outcome = await tool(args, signal);
      expect(outcome.ok, JSON.stringify(args)).toBe(false);
      expect(outcome.ok ? "" : outcome.error, JSON.stringify(args)).toMatch(expected);
      expect(executed).toEqual([]);
      expect(requestPermission).not.toHaveBeenCalled();
    }
  });

  it("does not let install_dependencies be narrowed", async () => {
    const { install, executed } = setup(web, []);
    const outcome = await install({ test_name: "x" }, signal);
    expect(outcome.ok).toBe(false);
    expect(executed).toEqual([]);
  });

  describe("in a project with a frontend runner and a backend runner", () => {
    it("runs the one a file belongs to and leaves the other alone, with cargo's --test for an integration test", async () => {
      const { tool, executed, requestPermission } = setup(tauri, [ok(cargoTestMatch)]);
      const outcome = await tool({ check: "test", test_file: "app/src-tauri/tests/api.rs" }, signal);
      expect(asked(requestPermission)).toHaveLength(1);
      expect(executed).toEqual([expect.objectContaining({ program: "cargo", args: ["test", "--test", "api"], cwd: "/ws/app/src-tauri" })]);
      expect(outcome.ok).toBe(true);
    });

    it("tries each for a name, and does not hold the one that matched nothing against the one that ran the test", async () => {
      const { tool, executed, requestPermission } = setup(tauri, [ok(vitestNameNoMatch), ok(cargoTestMatch)]);
      const outcome = await tool({ check: "test", test_name: "adds_two" }, signal);
      expect(asked(requestPermission)).toEqual([
        `The agent wants to run the project's test check (1 of 2, only test_name "adds_two"): npm run test -- -t adds_two`,
        `The agent wants to run the project's test check (2 of 2, only test_name "adds_two"): cargo test adds_two`,
      ]);
      expect(executed.map((run) => run.program)).toEqual(["npm", "cargo"]);
      expect(outcome.ok).toBe(true);
    });

    it("stops after the command that ran the test, so the user is not asked about one that has nothing to add", async () => {
      const { tool, executed, requestPermission } = setup(tauri, [ok(vitestNameMatch), ok(cargoTestMatch)]);
      const outcome = await tool({ check: "test", test_name: "orders checks" }, signal);
      expect(requestPermission).toHaveBeenCalledTimes(1);
      expect(executed).toHaveLength(1);
      expect(outcome.ok).toBe(true);
    });

    it("fails when neither runner has a test by that name", async () => {
      const { tool } = setup(tauri, [ok(vitestNameNoMatch), ok(cargoTestNoMatch)]);
      const outcome = await tool({ check: "test", test_name: "zzznomatch" }, signal);
      expect(outcome.ok).toBe(false);
      expect(outcome.ok ? "" : outcome.error).toContain("Nothing was checked");
    });
  });

  it("passes the name to pytest as -k", async () => {
    const { tool, executed } = setup({ "pyproject.toml": "[tool.pytest.ini_options]\n", "tests/test_math.py": "" }, [ok(pytestMatch)], { exists: [".venv"] });
    const outcome = await tool({ check: "test", test_name: "test_adds" }, signal);
    expect(executed).toEqual([expect.objectContaining({ args: ["-m", "pytest", "-k", "test_adds"] })]);
    expect(outcome.ok).toBe(true);
  });
});

describe("RUN_CHECK_TOOL", () => {
  it("offers exactly the check kinds the analysis can detect, and only check is required", () => {
    expect(RUN_CHECK_TOOL.name).toBe("run_check");
    expect(RUN_CHECK_TOOL.input_schema.required).toEqual(["check"]);
    const props = RUN_CHECK_TOOL.input_schema.properties as Record<string, { enum?: string[] }>;
    expect(Object.keys(props)).toEqual(["check", "path", "test_name", "test_file", "timeout_seconds"]);
    expect(props.check.enum).toEqual(["typecheck", "lint", "test", "build", "format"]);
  });

  it("does not list install among its checks, and sends the model to install_dependencies for it", () => {
    expect(CHECK_IDS).not.toContain("install");
    expect(RUN_CHECK_TOOL.description).toMatch(/call install_dependencies and run the check again/);
  });

  it("tells a model what it returns and that approval still applies", () => {
    expect(RUN_CHECK_TOOL.description).toMatch(/starts with PASSED or FAILED/);
    expect(RUN_CHECK_TOOL.description).toMatch(/environment/);
    expect(RUN_CHECK_TOOL.description).toMatch(/shown to the user for approval/);
  });
});
