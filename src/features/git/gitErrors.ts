/**
 * git.rs commands are being converted from a bare string error to a
 * structured GitError object ({operation, repository, exit_code, stderr,
 * message}) one PR-5a commit at a time. `String(err)` on the new shape
 * prints "[object Object]" -- and, for callers that used to substring-match
 * on the raw error text (e.g. merge/rebase conflict detection), silently
 * breaks that check instead of just looking wrong. `gitErrorMessage` reads
 * `.message` when present, falling back to `String(err)` for any command
 * not yet converted, so callers stay correct throughout the migration.
 */
export function gitErrorMessage(err: unknown): string {
  return (err as { message?: string } | undefined)?.message ?? String(err);
}

/** `git branch -d` refused because the branch has unmerged commits; the
 * caller can offer a forced delete (`-D`) instead of just failing. */
export class UnmergedBranchError extends Error {
  readonly name = "UnmergedBranchError";
}

export function isUnmergedBranchError(err: unknown): boolean {
  return /not fully merged/i.test(gitErrorMessage(err));
}
