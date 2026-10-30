// ============================================================
// filters/git/diff.ts -- unified diffs (`git diff`, `git show`,
// `gh pr diff`) stay unified diffs, minus what repeats or nobody reads:
//   - `index abc..def` lines and the `---`/`+++` pair (the `diff --git`
//     header names the file; mode, rename and binary lines stay)
//   - the body of lockfiles and generated files, replaced by a count
//   - changed lines past a cap within one hunk, replaced by a count
// Hunk headers and context lines stay, so the result still locates every
// change by line number.
// ============================================================

import { subcommand } from "../../invocation";
import type { CommandFilter, Invocation } from "../../types";
import { asksForNonPatchShape, gitSubcommand } from "./args";

const MAX_CHANGED_LINES_PER_HUNK = 150;

const GENERATED_NAMES = new Set([
  "package-lock.json", "npm-shrinkwrap.json", "yarn.lock", "pnpm-lock.yaml", "bun.lock", "cargo.lock", "poetry.lock",
  "uv.lock", "pipfile.lock", "gemfile.lock", "composer.lock", "go.sum", "flake.lock", "packages.lock.json",
]);

export function isGeneratedFile(path: string): boolean {
  const name = path.split("/").pop()!.toLowerCase();
  return GENERATED_NAMES.has(name) || /\.min\.(js|css)$|\.map$/.test(name);
}

function isDiffCommand(command: Invocation): boolean {
  if (command.tool === "gh") return subcommand(command) === "pr" && command.args.includes("diff");
  const sub = gitSubcommand(command);
  return (sub === "diff" || sub === "show") && !asksForNonPatchShape(command);
}

class DiffCompactor {
  private readonly out: string[] = [];
  private generated = false;
  private generatedCounts = { added: 0, removed: 0 };
  private beforeFirstHunk = true;
  private changedInHunk = 0;
  private hiddenInHunk = 0;

  add(line: string): void {
    const header = /^diff --git a\/(.+) b\/(.+)$/.exec(line);
    if (header) {
      this.closeFile();
      this.out.push(line);
      this.generated = isGeneratedFile(header[2]);
      this.beforeFirstHunk = true;
      return;
    }
    if (this.beforeFirstHunk && (/^index [0-9a-f]+\.\.[0-9a-f]+/.test(line) || line.startsWith("--- ") || line.startsWith("+++ "))) return;
    if (line.startsWith("@@")) {
      this.closeHunk();
      this.beforeFirstHunk = false;
      if (!this.generated) this.out.push(line);
      return;
    }
    if (this.beforeFirstHunk) {
      this.out.push(line);
      return;
    }
    this.addBodyLine(line);
  }

  private addBodyLine(line: string): void {
    const change = line.startsWith("+") || line.startsWith("-");
    if (this.generated) {
      if (line.startsWith("+")) this.generatedCounts.added += 1;
      else if (line.startsWith("-")) this.generatedCounts.removed += 1;
      return;
    }
    if (change) {
      this.changedInHunk += 1;
      if (this.changedInHunk > MAX_CHANGED_LINES_PER_HUNK) {
        this.hiddenInHunk += 1;
        return;
      }
    } else if (this.changedInHunk > MAX_CHANGED_LINES_PER_HUNK) {
      return;
    }
    // A commit header after a diff (`git show A B`) ends the diff body.
    if (!change && !line.startsWith(" ") && !line.startsWith("\\") && line !== "") this.beforeFirstHunk = true;
    this.out.push(line);
  }

  private closeHunk(): void {
    if (this.hiddenInHunk > 0) this.out.push(`  ... (${this.hiddenInHunk} more changed lines in this hunk)`);
    this.changedInHunk = 0;
    this.hiddenInHunk = 0;
  }

  private closeFile(): void {
    this.closeHunk();
    if (this.generated && !this.beforeFirstHunk) {
      this.out.push(`  (generated file: +${this.generatedCounts.added} -${this.generatedCounts.removed} lines not shown)`);
    }
    this.generated = false;
    this.generatedCounts = { added: 0, removed: 0 };
  }

  finish(): string {
    this.closeFile();
    return this.out.join("\n");
  }
}

export function compactDiff(output: string): string | undefined {
  if (!/^diff --git /m.test(output)) return undefined;
  const compactor = new DiffCompactor();
  for (const line of output.split("\n")) compactor.add(line);
  return compactor.finish();
}

export const gitDiffFilter: CommandFilter = {
  name: "diff",
  matches: isDiffCommand,
  apply: (output) => compactDiff(output),
};
