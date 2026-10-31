// ============================================================
// promptCache/index.ts -- measuring the prompt cache as callers use it:
// one watch per run, counted into the token-optimisation statistics.
// It changes nothing it measures, so it has no switch.
// ============================================================

import { recordCachedRequest } from "../stats";
import { PromptCacheWatch } from "./watch";

export type { CachedRequest, MissCause } from "./watch";
export { PromptCacheWatch };

export function createPromptCacheWatch(): PromptCacheWatch {
  return new PromptCacheWatch(recordCachedRequest);
}
