// ============================================================
// testFilter.ts -- turns "run just this test" into the arguments each test
// runner wants, for `run_check`'s `test_name` and `test_file`.
//
// A detected test command is usually a package script (`npm run test`), so
// the runner's own flags have to be passed through it, and each runner takes
// them differently: vitest and jest want `-t <regex>` for a name and a path
// for a file, pytest `-k` and a path, `cargo test` a positional name or
// `--test <file stem>`, `go test` `-run <regex>` and a package path. Only
// runners whose syntax is known are narrowed; for any other, the caller is
// told to run the whole check or use `run_command`, never handed a guess.
//
// Pure: no I/O, so every runner's argument shape is tested directly.
// ============================================================

import type { Check } from "./projectInfo";

export interface TestSelector {
  name?: string;
  file?: string;
}

const MAX_SELECTOR_CHARS = 300;

const isEmpty = (selector: TestSelector) => selector.name === undefined && selector.file === undefined;

/**
 * Reads the two tool inputs. A value starting with `-` is refused because the
 * runner would take it for one of its own flags, and a file must stay inside
 * the project, so neither can be used to pass an option of the model's choosing.
 */
export function parseSelector(name: unknown, file: unknown): { ok: true; selector: TestSelector } | { ok: false; error: string } {
  const selector: TestSelector = {};
  for (const [label, value] of [["test_name", name], ["test_file", file]] as const) {
    if (value === undefined || value === null || value === "") continue;
    if (typeof value !== "string") return { ok: false, error: `${label} must be a string.` };
    const text = label === "test_file" ? value.trim().replace(/\\/g, "/").replace(/^(\.\/)+/, "") : value.trim();
    if (text === "") continue;
    if (text.length > MAX_SELECTOR_CHARS || /[\u0000-\u001f]/.test(text)) return { ok: false, error: `${label} is too long or contains control characters.` };
    if (text.startsWith("-")) return { ok: false, error: `${label} cannot start with "-": the test runner would read it as an option.` };
    if (label === "test_file") {
      if (text.startsWith("/") || /^[a-zA-Z]:/.test(text) || text.split("/").includes("..")) {
        return { ok: false, error: "test_file must be a path inside the workspace, relative to its root (or to the project folder)." };
      }
      selector.file = text;
    } else {
      selector.name = text;
    }
  }
  return { ok: true, selector };
}

/** What the filter says in a report header, such as `test_name "adds two"`. */
export function describeSelector(selector: TestSelector): string {
  return [selector.name !== undefined ? `test_name "${selector.name}"` : undefined, selector.file !== undefined ? `test_file "${selector.file}"` : undefined]
    .filter(Boolean)
    .join(" and ");
}

export type Narrowing =
  | { ok: true; check: Check }
  /** This command is for something else than the file asked for; another command may fit. */
  | { ok: false; kind: "inapplicable"; error: string }
  /** The command's runner cannot be narrowed this way. */
  | { ok: false; kind: "unsupported"; error: string }
  /** The request cannot be met by this runner whatever the command is. */
  | { ok: false; kind: "invalid"; error: string };

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const JS_FILE = /\.(?:[cm]?[jt]sx?)$/;

/** `file` relative to the folder the command runs in. */
function relativeTo(cwd: string, file: string): string {
  return cwd !== "." && file.startsWith(`${cwd}/`) ? file.slice(cwd.length + 1) : file;
}

/** Adds arguments after a package script's own. `npm run` needs `--` to pass them on. */
function appendScriptArgs(check: Check, extra: string[]): string[] {
  if (extra.length === 0) return check.args;
  if (check.program === "npm" && check.args[0] === "run" && !check.args.includes("--")) return [...check.args, "--", ...extra];
  return [...check.args, ...extra];
}

const narrowed = (check: Check, args: string[]): Narrowing => ({ ok: true, check: { ...check, args } });
const inapplicable = (check: Check, file: string, wanted: string): Narrowing => ({
  ok: false,
  kind: "inapplicable",
  error: `${file} is not ${wanted}, so it is not part of the ${check.runner} tests run from ${check.cwd === "." ? "the workspace root" : check.cwd}.`,
});

/**
 * The `check` command restricted to `selector`, or why it cannot be.
 * `check` must be a test check; a command with no known runner is unsupported.
 */
export function narrowTestCheck(check: Check, selector: TestSelector): Narrowing {
  if (isEmpty(selector)) return { ok: true, check };
  const { name, file } = selector;

  switch (check.runner) {
    case "vitest":
    case "jest": {
      const extra: string[] = [];
      if (file !== undefined) {
        if (!JS_FILE.test(file) && file.includes(".") && !file.endsWith("/")) return inapplicable(check, file, `a ${check.runner} test file`);
        extra.push(relativeTo(check.cwd, file));
      }
      if (name !== undefined) extra.push("-t", escapeRegExp(name));
      return narrowed(check, appendScriptArgs(check, extra));
    }

    case "pytest": {
      const extra: string[] = [];
      if (file !== undefined && !/\.py(?:::|$)/.test(file) && file.includes(".")) return inapplicable(check, file, "a pytest test file");
      if (file !== undefined) extra.push(relativeTo(check.cwd, file));
      if (name !== undefined) {
        if (name.includes("::")) {
          if (file === undefined) extra.push(relativeTo(check.cwd, name));
          else return { ok: false, kind: "invalid", error: "Give a pytest node id (path::test) as test_name alone, or a file and a plain test name." };
        } else if (/^[\w.[\]-]+$/.test(name)) {
          extra.push("-k", name);
        } else {
          return { ok: false, kind: "invalid", error: `pytest selects tests by their function name, so test_name cannot contain spaces or punctuation: use for example "test_parses_empty_input", or pass test_file.` };
        }
      }
      return narrowed(check, [...check.args, ...extra]);
    }

    case "cargo": {
      const flags: string[] = [];
      if (file !== undefined) {
        if (!file.endsWith(".rs")) return inapplicable(check, file, "a Rust source file");
        const target = /(?:^|\/)tests\/([^/]+)\.rs$/.exec(file);
        if (!target) {
          return { ok: false, kind: "invalid", error: `cargo cannot run the tests of one source file; it selects unit tests by name. Pass test_name with the test's module path, for example "parser::tests::empty_input", or a file under tests/ to run that integration test.` };
        }
        flags.push("--test", target[1]);
      }
      return narrowed(check, [...check.args, ...flags, ...(name !== undefined ? [name] : [])]);
    }

    case "go": {
      const target = check.args.lastIndexOf("./...");
      if (check.args[0] !== "test" || target < 0) return { ok: false, kind: "unsupported", error: `The go test command (${check.args.join(" ")}) has a shape run_check does not know how to narrow.` };
      const args = [...check.args];
      const flags: string[] = [];
      if (name !== undefined) flags.push("-run", escapeRegExp(name));
      if (file !== undefined) {
        if (!file.endsWith(".go")) return inapplicable(check, file, "a Go source file");
        const directory = relativeTo(check.cwd, file).split("/").slice(0, -1).join("/");
        args[target] = directory === "" ? "." : `./${directory}`;
      }
      args.splice(target, 0, ...flags);
      return narrowed(check, args);
    }

    default:
      return {
        ok: false,
        kind: "unsupported",
        error: `The test command (${[check.program, ...check.args].join(" ")}) is not one run_check can narrow to a single test; it knows vitest, jest, pytest, cargo test and go test. Run the whole test check, or use run_command with that runner's own filter option.`,
      };
  }
}
