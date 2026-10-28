// ============================================================
// definitions/passChecks.ts -- what the run's checks last said, and whether an edit came after:
// the goal loop judges a pass by the checks the pass itself ran, and a check run before the last
// edit proves nothing about the code as it is left.
// ============================================================

import type { HostToolHandler } from "../CoreHarness";

export interface PassCheck {
  name: string;
  passed: boolean;
  /** The check ran after the run's last edit. */
  ran: boolean;
  /** The first lines of what it reported. */
  summary: string;
}

const SUMMARY_CHARS = 600;

export class PassCheckLog {
  private edits = 0;
  private latest = new Map<string, { passed: boolean; summary: string; edits: number }>();

  edited() {
    this.edits += 1;
  }

  record(name: string, passed: boolean, text: string) {
    this.latest.set(name, { passed, summary: text.slice(0, SUMMARY_CHARS), edits: this.edits });
  }

  results(): PassCheck[] {
    return [...this.latest.entries()].map(([name, check]) => ({ name, passed: check.passed, ran: check.edits === this.edits, summary: check.summary }));
  }
}

/** run_check, recording each whole check's outcome; a check narrowed to one test or file says
 * nothing about the whole project and is not recorded. */
export function recordingChecks(handler: HostToolHandler, log: PassCheckLog): HostToolHandler {
  return async (args, signal, observer, call) => {
    const outcome = await handler(args, signal, observer, call);
    const input = (args ?? {}) as { check?: unknown; test_name?: unknown; test_file?: unknown; background?: unknown };
    const narrowed = Boolean(input.test_name || input.test_file);
    // A background check reports when its job finishes, which the log does not follow.
    if (typeof input.check === "string" && !narrowed && input.background !== true) {
      log.record(input.check.trim().toLowerCase(), outcome.ok, String(outcome.ok ? outcome.output : outcome.error));
    }
    return outcome;
  };
}

/** An edit tool that tells the log an edit happened, so earlier checks no longer count. */
export function countingEdits(handler: HostToolHandler, log: PassCheckLog): HostToolHandler {
  return async (args, signal, observer, call) => {
    const outcome = await handler(args, signal, observer, call);
    if (outcome.ok) log.edited();
    return outcome;
  };
}
