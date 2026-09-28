import type { NormalizedCommand } from "../commandPolicy";
import { classifyCommandRisk } from "../commandPolicy";

/** Existing files shorter than this are never flagged for how much they lose. */
const MIN_LINES_FOR_REMOVAL_CHECK = 20;
/** Share of an existing file's lines a rewrite may drop before it is flagged. */
export const MAX_REMOVED_SHARE = 0.5;

/**
 * Lines that stand in for code instead of containing it -- the classic way a
 * whole-file rewrite silently deletes everything the model did not repeat.
 * Only comment-like lines are matched, so ordinary code mentioning these
 * words is not.
 */
const PLACEHOLDER_LINE =
  /^\s*(?:\/\/|#|--|\/\*+|\*|<!--)?\s*(?:\.\.\.|…)?\s*(?:\(?\s*)?(?:rest of (?:the )?(?:file|code|implementation|class|function|component)|(?:the )?rest (?:is|remains) (?:the same|unchanged)|existing (?:code|implementation|methods|functions)(?: (?:here|goes here|unchanged|remains?(?: the same| unchanged)?))?|remaining (?:code|methods|functions)(?: unchanged)?|(?:code|everything else|other (?:methods|functions)) (?:remains? )?unchanged|same as before|unchanged (?:code|below|above))\b.*$/i;

function meaningfulLines(content: string): string[] {
  return content.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

/**
 * Why overwriting `previous` with `next` is risky; `undefined` when it is
 * not (including creating a new file, `previous === undefined`).
 */
export function writeRisk(previous: string | undefined, next: string): string | undefined {
  if (previous === undefined || previous === next) return undefined;
  const before = meaningfulLines(previous);
  if (before.length === 0) return undefined;
  const after = meaningfulLines(next);
  if (after.length === 0) return `It empties an existing file of ${before.length} lines.`;

  const placeholder = next.split(/\r?\n/).find((line) => PLACEHOLDER_LINE.test(line) && !previous.includes(line.trim()));
  if (placeholder) {
    return `The new content contains a placeholder instead of real code ("${placeholder.trim().slice(0, 120)}"); writing it would delete the code it stands for.`;
  }

  if (before.length < MIN_LINES_FOR_REMOVAL_CHECK) return undefined;
  const kept = new Set(after);
  const removed = before.filter((line) => !kept.has(line)).length;
  const share = removed / before.length;
  if (share < MAX_REMOVED_SHARE) return undefined;
  return `It removes ${removed} of the file's ${before.length} lines (${Math.round(share * 100)}%).`;
}

/** Why running `command` is risky; `undefined` unless it is classified destructive. */
export function commandRisk(command: NormalizedCommand): string | undefined {
  return classifyCommandRisk(command) === "destructive"
    ? "It is a destructive command: it can delete data, rewrite history, or change systems outside the workspace."
    : undefined;
}
