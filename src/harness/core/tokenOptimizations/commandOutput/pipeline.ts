// ============================================================
// commandOutput/pipeline.ts -- one output through the layers:
//   normalize (generic.ts) -> the first matching filter (registry.ts)
//   -> finish (generic.ts) -> never worse (safeguards).
// A filter that throws or returns undefined leaves the output to the
// generic layer alone (fail open): condensing never stops a command's
// output reaching the model.
// ============================================================

import { failOpen, neverWorse } from "../safeguards/guards";
import { finish, normalize } from "./generic";
import { FILTERS } from "./registry";
import type { CommandFilter, Invocation } from "./types";

export interface Shaped {
  /** The normalized output, before any filter: what is kept for recall. */
  normalized: string;
  text: string;
  filter: string;
}

function applyFilter(filter: CommandFilter | undefined, normalized: string, command: Invocation): { text: string; filter: string } {
  if (!filter) return { text: normalized, filter: "generic" };
  const text = failOpen(() => filter.apply(normalized, command), undefined);
  if (text === undefined) return { text: normalized, filter: "generic" };
  if (text.trim() === "" && normalized.trim() !== "") {
    return { text: `(${filter.name}: nothing but progress and noise; ${normalized.split("\n").length} lines left out)`, filter: filter.name };
  }
  return { text, filter: filter.name };
}

export function shapeOutput(command: Invocation, raw: string, filters: readonly CommandFilter[] = FILTERS): Shaped {
  const normalized = normalize(raw);
  const chosen = applyFilter(filters.find((filter) => failOpen(() => filter.matches(command), false)), normalized, command);
  const guarded = neverWorse(normalized, finish(chosen.text));
  return { normalized, text: guarded.text, filter: guarded.used ? chosen.filter : "none" };
}
