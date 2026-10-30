import { describe, expect, it } from "vitest";
import find from "../../../../__fixtures__/commands/find.txt?raw";
import grepRn from "../../../../__fixtures__/commands/grep_rn.txt?raw";
import lsLa from "../../../../__fixtures__/commands/ls_la.txt?raw";
import { toInvocation } from "../../invocation";
import { grepFilter } from "./grep";
import { lsFilter } from "./ls";
import { pathListFilter } from "./paths";

describe("ls", () => {
  it("keeps mode, size and name of a long listing and drops total, . and ..", () => {
    const out = lsFilter.apply(lsLa, toInvocation("ls", ["-la", "x"], 0))!;
    const lines = out.split("\n");
    expect(lines).toHaveLength(lsLa.trim().split("\n").length - 3);
    expect(lines[0]).toBe("-rw-r--r--    721  cargo_check.txt");
    expect(out).not.toContain("staff");
    expect(out.length).toBeLessThan(lsLa.length * 0.6);
  });

  it("marks directories, keeps section headers and leaves unparsed listings alone", () => {
    const out = lsFilter.apply("a:\ndrwxr-xr-x  3 me  staff  96 Oct  1 22:42 src\n\nb:\n-rw-r--r--  1 me  staff  2048 Jan 10  2025 big.bin", toInvocation("ls", ["-l", "a", "b"], 0));
    expect(out).toBe("a:\ndrwxr-xr-x      -  src/\n\nb:\n-rw-r--r--   2.0K  big.bin");
    expect(lsFilter.apply("weird line", toInvocation("ls", ["-l"], 0))).toBeUndefined();
  });

  it("caps a huge plain listing", () => {
    const names = Array.from({ length: 160 }, (_, i) => `pkg-${i}`).join("\n");
    expect(lsFilter.apply(names, toInvocation("ls", ["node_modules"], 0))!.split("\n").at(-1)).toBe("... 10 more entries");
  });
});

describe("path lists", () => {
  it("groups a long find result by directory", () => {
    const out = pathListFilter.apply(find, toInvocation("find", ["src/harness/core/definitions", "-name", "*.test.ts"], 0))!;
    expect(out.split("\n").slice(0, 2)).toEqual(["40 paths in 1 directory:", "src/harness/core/definitions/ (40)"]);
    expect(out.length).toBeLessThan(find.length * 0.6);
  });

  it("leaves short lists and find actions alone, and covers grep -l and git ls-files", () => {
    expect(pathListFilter.apply("a.ts\nb.ts", toInvocation("find", ["."], 0))).toBeUndefined();
    expect(pathListFilter.matches(toInvocation("find", [".", "-exec", "wc", "{}", ";"], 0))).toBe(false);
    expect(pathListFilter.matches(toInvocation("grep", ["-rl", "x", "."], 0))).toBe(false);
    expect(pathListFilter.matches(toInvocation("grep", ["-l", "-r", "x", "."], 0))).toBe(true);
    expect(pathListFilter.matches(toInvocation("git", ["ls-files"], 0))).toBe(true);
  });
});

describe("search", () => {
  it("groups numbered matches by file and keeps every match", () => {
    const out = grepFilter.apply(grepRn, toInvocation("grep", ["-rn", "stripAnsi", "src/harness/core"], 0))!;
    expect(out.split("\n").slice(0, 3)).toEqual([
      "src/harness/core/checkReport.ts",
      '  10: import { classifyFailure, parseCheckOutput, stripAnsi, type Failure, type Issue } from "./checkOutput";',
      "  108:   const all = stripAnsi(output).split(/\\r?\\n/);",
    ]);
    expect(out.match(/^  \d+: /gm)).toHaveLength(grepRn.trim().split("\n").length);
  });

  it("clips matches in minified files and caps matches per file", () => {
    const lines = Array.from({ length: 35 }, (_, i) => `dist/app.min.js:${i + 1}:${"x".repeat(400)}`).join("\n");
    const out = grepFilter.apply(`${lines}\nsrc/a.ts:3:x`, toInvocation("rg", ["-n", "x"], 0))!;
    expect(out).toContain("dist/app.min.js (35 matches)");
    expect(out).toContain("  ... +5 more in this file");
    expect(out).toContain("… [+100 chars]");
    expect(out).toContain("src/a.ts\n  3: x");
  });

  it("does not regroup single-file output, context or counts", () => {
    expect(grepFilter.apply("12:const a = 1;\n40:const b = 2;", toInvocation("grep", ["-n", "const", "a.ts"], 0))).toBe("12:const a = 1;\n40:const b = 2;");
    expect(grepFilter.apply("a.ts-11-before\na.ts:12:match", toInvocation("grep", ["-n", "-C", "1", "match", "a.ts", "b.ts"], 0))).toBe("a.ts-11-before\na.ts:12:match");
    expect(grepFilter.apply("TODO: one\nTODO: two", toInvocation("grep", ["TODO", "notes.txt"], 0))).toBe("TODO: one\nTODO: two");
  });
});
