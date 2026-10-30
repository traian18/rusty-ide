// ============================================================
// commandOutput/condenser.ts -- the CommandOutputCondenser: shapes one
// command's output (pipeline.ts), keeps the full output when something
// was left out (recall/), fits the result into the model's budget, stamps
// it (safeguards/stamps.ts) and counts what it did (stats.ts). Everything
// it depends on is injected, defaulting to the app's own switches, store
// and statistics, so a test or another host can plug in its own.
// ============================================================

import type { OptimizationId } from "../catalog";
import { readEntry, type RecallQuery, type Recalled } from "../recall/read";
import { isRecallId } from "../recall/contentId";
import { sessionRecallStore, type RecallStore } from "../recall/store";
import { hasStamp, renderStamp } from "../safeguards/stamps";
import { recordCondensed, recordRecall } from "../stats";
import { isOptimizationEnabled } from "../switches";
import { normalize } from "./generic";
import { toInvocation } from "./invocation";
import { shapeOutput } from "./pipeline";
import type { CommandOutputCondenser, CommandRun, Condensed, ShapeInput } from "./types";

export const OUTPUT_LIMITS = {
  /** The most a command's result may hand the model; the tail is kept. */
  maxChars: 32_000,
  /** Shorter outputs are neither kept nor stamped: dropping a hint line from a short `git status` needs no way back. */
  recallFromChars: 1_500,
} as const;

export const TRUNCATION_MARKER = "...(truncated)...";

export interface CondenserDeps {
  store: RecallStore;
  isEnabled: (id: OptimizationId) => boolean;
  onCondensed: (filter: string, rawChars: number, shownChars: number, stored: boolean) => void;
  onRecalled: (filter: string) => void;
}

const appDeps: CondenserDeps = { store: sessionRecallStore, isEnabled: isOptimizationEnabled, onCondensed: recordCondensed, onRecalled: recordRecall };

const chars = (count: number) => `${count.toLocaleString("en-US")} chars`;

/** The tail of `text` within the budget, marked when anything before it was cut. */
function fitBudget(text: string, captureTruncated: boolean): string {
  if (text.length > OUTPUT_LIMITS.maxChars) return `${TRUNCATION_MARKER}\n${text.slice(-OUTPUT_LIMITS.maxChars)}`;
  return captureTruncated ? `${TRUNCATION_MARKER}\n${text}` : text;
}

const sameText = (a: string, b: string) => a.trimEnd() === b.trimEnd();

export class Condenser implements CommandOutputCondenser {
  private readonly deps: CondenserDeps;

  constructor(deps: Partial<CondenserDeps> = {}) {
    this.deps = { ...appDeps, ...deps };
  }

  condense(run: CommandRun): Condensed {
    const rawChars = run.output.length;
    const captureTruncated = run.captureTruncated === true;
    const asIs = (filter: string, text: string): Condensed => ({ text, body: text, filter, rawChars, shownChars: text.length });
    if (run.raw) return asIs("raw", fitBudget(normalize(run.output), captureTruncated));
    if (!this.deps.isEnabled("command-output")) return asIs("off", fitBudget(normalize(run.output), captureTruncated));
    // Single-site rule: text another pass already condensed is not condensed again.
    if (hasStamp(run.output)) return asIs("stamped", fitBudget(run.output, captureTruncated));

    const label = [run.program, ...run.args].join(" ").slice(0, 120);
    const shaped = shapeOutput(toInvocation(run.program, run.args, run.exitCode), run.output);
    const leftOut = !sameText(shaped.text, shaped.normalized) || shaped.text.length > OUTPUT_LIMITS.maxChars || captureTruncated;
    const significant = leftOut && rawChars >= OUTPUT_LIMITS.recallFromChars;
    const keep = significant && run.recallable !== false && this.deps.isEnabled("recall");
    const recallId = keep ? this.deps.store.put({ label, source: shaped.filter, text: shaped.normalized }) : undefined;
    // A filter that changed nothing but trailing whitespace hands back the output as printed.
    const body = fitBudget(leftOut ? shaped.text : shaped.normalized, captureTruncated);
    const stamp = significant ? `\n${renderStamp({ action: "condensed", method: shaped.filter, rawChars, shownChars: body.length, recallId })}` : "";
    const text = `${body}${stamp}`;
    this.deps.onCondensed(shaped.filter, rawChars, text.length, keep);
    const summary = significant || rawChars - text.length > 500
      ? `Condensed the output of ${label} (${shaped.filter}): ${chars(rawChars)} -> ${chars(text.length)}${recallId ? `, full output kept as ${recallId}` : ""}.`
      : undefined;
    return { text, body, filter: shaped.filter, recallId, rawChars, shownChars: text.length, summary };
  }

  shape(input: ShapeInput): string {
    if (!this.deps.isEnabled("command-output") || hasStamp(input.output)) return normalize(input.output);
    return shapeOutput(toInvocation(input.program, input.args, input.exitCode), input.output).text;
  }

  owns(id: string): boolean {
    return isRecallId(id);
  }

  recall(id: string, query?: RecallQuery): Recalled {
    const entry = this.deps.store.get(id);
    if (!entry) {
      return { ok: false, error: `No stored output ${id}. Rusty keeps the last condensed outputs until it quits; run the command again if it is safe to.` };
    }
    if (!entry.recalled) {
      entry.recalled = true;
      this.deps.onRecalled(entry.source);
    }
    return readEntry(entry, query);
  }
}
