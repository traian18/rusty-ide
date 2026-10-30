// ============================================================
// commandOutput/types.ts -- the shapes command-output condensing is built
// from. The public ones (CommandRun, ShapeInput, Condensed,
// CommandOutputCondenser) are re-exported by the module's index.ts;
// Invocation and CommandFilter are internal, the contract every filter
// implements.
// ============================================================

import type { RecallQuery, Recalled } from "../recall/read";

export type { RecallQuery, Recalled };

/** What `shape` is given: a command and what it printed. A `sh -c "<line>"` call is read as the line's own command. */
export interface ShapeInput {
  /** The executable as the model gave it, such as "git" or "./mvnw". */
  program: string;
  args: readonly string[];
  exitCode: number | null;
  /** Combined stdout and stderr, as captured. */
  output: string;
}

/** What `condense` is given: one finished command and everything it printed. */
export interface CommandRun extends ShapeInput {
  /** The capture kept only the end of what the command printed. */
  captureTruncated?: boolean;
  /** Return the output as printed: only the size budget applies. */
  raw?: boolean;
  /** False when the caller's model has no job_output to read a kept output with: nothing is kept, the stamp says so. */
  recallable?: boolean;
}

/** What `condense` returns: the text the model reads, ready to print. */
export interface Condensed {
  /** The condensed output, ending with a stamp (and its recall id) when something was left out. */
  text: string;
  /** `text` without its stamp, for a caller that writes its own pointer to the full output (a check report). */
  body: string;
  /** The filter that shaped it: "generic" when no specific one matched, "raw" when asked for raw, "off" when switched off, "stamped" when already condensed. */
  filter: string;
  /** Recall id of the stored full output, when one was stored. */
  recallId?: string;
  rawChars: number;
  shownChars: number;
  /** One line for the activity log, or undefined when nothing worth reporting changed. */
  summary?: string;
}

/** Command-output condensing, as the tools use it. */
export interface CommandOutputCondenser {
  /** A finished command's output, ready to hand the model: condensed, kept, fitted, stamped. */
  condense(run: CommandRun): Condensed;
  /** Only the shaping, for a text another tool frames itself (a check's tail, a job's progress): nothing is kept or stamped. */
  shape(input: ShapeInput): string;
  /** Whether `id` names a kept output (so `job_output` knows to ask here). */
  owns(id: string): boolean;
  recall(id: string, query?: RecallQuery): Recalled;
}

/** A command as the filters see it: wrappers such as `npx` or `python -m` are already unwrapped. */
export interface Invocation {
  /** The tool doing the work, as a lower-case basename: `npx vitest run` gives "vitest". */
  tool: string;
  /** Its own arguments, after the wrapper's. */
  args: readonly string[];
  exitCode: number | null;
}

/**
 * One command family's condensing. `apply` gets output that is already free of
 * ANSI codes and progress redraws, and returns the condensed text, or
 * undefined when the output is not in the shape it knows (it then passes on
 * unchanged). A filter only ever removes or summarises what the tool printed;
 * it never invents a different format.
 */
export interface CommandFilter {
  readonly name: string;
  matches(command: Invocation): boolean;
  apply(output: string, command: Invocation): string | undefined;
}
