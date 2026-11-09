// ============================================================
// modelLimits/ -- context limits for models whose provider catalog lists
// none. Starts from the snapshot bundled with the app; `refreshModelLimits`
// swaps in the app's own copy, which rusty-ide's backend checks against
// LiteLLM at most once a day (src-tauri harness/model_limits.rs).
// ============================================================

import { fetchModelLimits } from "./client";
import snapshot from "./litellmSnapshot.json";
import { lookupModelLimits, type LimitsEntries, type ModelLimits } from "./lookup";

export type { ModelLimits } from "./lookup";

let entries = snapshot.entries as unknown as LimitsEntries;

/** The catalog's limits for `model` on `providerId`, if it has them. */
export function modelLimitsFor(providerId: string | undefined, model: string): ModelLimits | undefined {
  return lookupModelLimits(entries, providerId, model);
}

let refreshing: Promise<void> | undefined;

/** Replaces the bundled snapshot with the app's copy. Never throws; a failure keeps what there is. */
export function refreshModelLimits(): Promise<void> {
  refreshing ??= fetchModelLimits()
    .then((copy) => {
      if (copy && Object.keys(copy.entries).length > 0) entries = copy.entries;
    })
    .catch((error: unknown) => console.warn("Could not refresh model context limits; keeping the current ones:", error))
    .finally(() => { refreshing = undefined; });
  return refreshing;
}
