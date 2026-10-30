import { describe, expect, it } from "vitest";
import gitDiffLockfile from "../../../../__fixtures__/commands/git_diff_lockfile.txt?raw";
import gitLog from "../../../../__fixtures__/commands/git_log.txt?raw";
import gitStatus from "../../../../__fixtures__/commands/git_status.txt?raw";
import { toInvocation } from "../../invocation";
import { gitDiffFilter } from "./diff";
import { gitLogFilter, shortDate } from "./log";
import { gitRemoteFilter } from "./remote";
import { gitStatusFilter } from "./status";

const git = (...args: string[]) => toInvocation("git", args, 0);

describe("git status", () => {
  it("drops git's advice and blank lines and keeps the branch, headers and every file", () => {
    const out = gitStatusFilter.apply(gitStatus, git("status"))!;
    expect(out).not.toContain("(use ");
    expect(out).not.toMatch(/\n\n/);
    expect(out).toContain("Your branch is ahead of 'origin/main' by 1 commit.");
    for (const line of gitStatus.split("\n").filter((l) => l.startsWith("\t"))) expect(out).toContain(line);
    expect(out.length).toBeLessThan(gitStatus.length * 0.85);
  });

  it("caps a very long section and keeps the closing line without its advice", () => {
    const files = Array.from({ length: 45 }, (_, i) => `\tf${i}.txt`).join("\n");
    const out = gitStatusFilter.apply(`On branch main\nUntracked files:\n  (use "git add <file>..." to include in what will be committed)\n${files}\n\nnothing added to commit but untracked files present (use "git add" to track)\n`, git("status"))!;
    expect(out.split("\n")).toEqual(["On branch main", "Untracked files:", ...Array.from({ length: 40 }, (_, i) => `\tf${i}.txt`), "\t... 5 more files", "nothing added to commit but untracked files present"]);
  });

  it("leaves short and porcelain formats to the model", () => {
    expect(gitStatusFilter.matches(git("status", "-s"))).toBe(false);
    expect(gitStatusFilter.matches(git("status", "--porcelain=v2"))).toBe(false);
    expect(gitStatusFilter.matches(git("-C", "repo", "status"))).toBe(true);
  });
});

describe("git log", () => {
  it("writes one line per commit with its refs, date, author, subject and body size", () => {
    expect(gitLogFilter.apply(gitLog, git("log", "-3"))!.split("\n")).toEqual([
      "a297ac4 2026-10-30 [Dev Person] Frontend: group code by feature (+13 body lines)",
      "49c9cb6 2026-10-28 [Dev Person] Release v0.1.65 (+1 body line)",
      "5b185f8 2026-10-28 [Dev Person] Terminal: name the spawn result type, which clippy found too complex",
    ]);
  });

  it("keeps decorations and marks merges", () => {
    const out = gitLogFilter.apply("commit abcdef1234567 (HEAD -> main, origin/main)\nMerge: 1111111 2222222\nAuthor: A <a@x>\nDate:   2026-01-02 10:00:00 +0000\n\n    Merge branch 'x'\n", git("log"));
    expect(out).toBe("abcdef1 (HEAD -> main, origin/main) 2026-01-02 [A] (merge) Merge branch 'x'");
  });

  it("leaves formats the model chose, and output it does not recognise", () => {
    expect(gitLogFilter.matches(git("log", "--oneline"))).toBe(false);
    expect(gitLogFilter.matches(git("log", "--format=%H"))).toBe(false);
    expect(gitLogFilter.matches(git("log", "-p"))).toBe(false);
    expect(gitLogFilter.apply("fatal: bad revision 'nope'\n", git("log"))).toBeUndefined();
  });

  it("reads git's default date and ISO dates", () => {
    expect(shortDate("Thu Oct  1 09:05:00 2026 +0200")).toBe("2026-10-01");
    expect(shortDate("2026-10-30T12:00:00+02:00")).toBe("2026-10-30");
    expect(shortDate("yesterday")).toBe("yesterday");
  });
});

describe("diff", () => {
  it("drops index and ---/+++ lines and reduces lockfiles to a count", () => {
    const out = gitDiffFilter.apply(gitDiffLockfile, git("diff", "5b185f8", "49c9cb6"))!;
    expect(out.split("\n")).toEqual([
      "diff --git a/package-lock.json b/package-lock.json",
      "  (generated file: +2 -2 lines not shown)",
      "diff --git a/package.json b/package.json",
      "@@ -1,7 +1,7 @@",
      " {",
      '   "name": "rusty-ide",',
      '   "private": true,',
      '-  "version": "0.1.64",',
      '+  "version": "0.1.65",',
      '   "type": "module",',
      '   "engines": {',
      '     "node": ">=22.12"',
      "",
    ]);
  });

  it("caps the changed lines of one huge hunk and says how many it hid", () => {
    const body = Array.from({ length: 200 }, (_, i) => `+line ${i}`).join("\n");
    const out = gitDiffFilter.apply(`diff --git a/x.ts b/x.ts\nnew file mode 100644\nindex 0000000..1111111\n--- /dev/null\n+++ b/x.ts\n@@ -0,0 +1,200 @@\n${body}\n`, git("show"))!;
    const lines = out.split("\n");
    expect(lines.slice(0, 3)).toEqual(["diff --git a/x.ts b/x.ts", "new file mode 100644", "@@ -0,0 +1,200 @@"]);
    expect(lines.filter((l) => l.startsWith("+line"))).toHaveLength(150);
    expect(out).toContain("  ... (50 more changed lines in this hunk)");
  });

  it("applies to gh pr diff and leaves stat and word-diff shapes alone", () => {
    expect(gitDiffFilter.matches(toInvocation("gh", ["pr", "diff", "12"], 0))).toBe(true);
    expect(gitDiffFilter.matches(git("diff", "--stat"))).toBe(false);
    expect(gitDiffFilter.matches(git("diff", "--word-diff"))).toBe(false);
    expect(gitDiffFilter.matches(git("diff", "--word-diff=none"))).toBe(true);
    expect(gitDiffFilter.apply("no diff here", git("show", "v1.0"))).toBeUndefined();
  });
});

describe("git commands that change something", () => {
  it("drops transfer progress and keeps where the refs went", () => {
    const push = [
      "Enumerating objects: 12, done.",
      "Counting objects: 100% (12/12), done.",
      "Delta compression using up to 10 threads",
      "Compressing objects: 100% (6/6), done.",
      "Writing objects: 100% (7/7), 1.20 KiB | 1.20 MiB/s, done.",
      "Total 7 (delta 4), reused 0 (delta 0), pack-reused 0",
      "remote: Resolving deltas: 100% (4/4), completed with 4 local objects.",
      "To github.com:me/repo.git",
      "   a297ac4..03ec207  main -> main",
    ].join("\n");
    expect(gitRemoteFilter.apply(push, git("push"))).toBe("To github.com:me/repo.git\n   a297ac4..03ec207  main -> main");
  });

  it("caps long create-mode and diffstat lists but keeps the totals", () => {
    const created = Array.from({ length: 15 }, (_, i) => ` create mode 100644 src/f${i}.ts`).join("\n");
    const out = gitRemoteFilter.apply(`[main 1a2b3c4] Add files\n 15 files changed, 300 insertions(+)\n${created}`, git("commit", "-m", "Add files"))!;
    expect(out.split("\n")).toHaveLength(2 + 10 + 1);
    expect(out).toContain(" ... 5 more files created, deleted or renamed");
  });
});
