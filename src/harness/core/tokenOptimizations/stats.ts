// ============================================================
// stats.ts -- what the optimisations did, kept across app restarts until
// reset: per command filter, how much output came in and went out, how
// many full outputs were kept and how many of those the model read back
// (the recall rate: a filter that is often read back leaves out too
// much), how many model switches the warm-cache guard refused, and how
// well requests used the prompt cache (promptCache/watch.ts judges them).
// ============================================================

import { persisted } from "./persisted";
import type { CachedRequest, MissCause } from "./promptCache/watch";

export interface FilterStats {
  /** Command results it shaped. */
  runs: number;
  rawChars: number;
  shownChars: number;
  /** Full outputs kept for recall. */
  stored: number;
  /** Kept outputs the model read back at least once. */
  recalled: number;
}

export interface PromptCacheStats {
  requests: number;
  /** Requests that could have read from the cache (not an agent's first). */
  followUps: number;
  /** Follow-ups whose provider reported no cache reads, so not judged. */
  unreported: number;
  input: number;
  cacheRead: number;
  cacheWrite: number;
  /** Follow-ups that read less than half the previous prompt, by cause. */
  misses: Record<MissCause, number>;
}

export interface TokenOptimizationStats {
  /** ISO time the counting started. */
  since: string;
  filters: Record<string, FilterStats>;
  refusedModelSwitches: number;
  promptCache: PromptCacheStats;
}

const emptyPromptCache = (): PromptCacheStats => ({ requests: 0, followUps: 0, unreported: 0, input: 0, cacheRead: 0, cacheWrite: 0, misses: { prefix: 0, expired: 0, history: 0 } });

const empty = (): TokenOptimizationStats => ({ since: new Date().toISOString(), filters: {}, refusedModelSwitches: 0, promptCache: emptyPromptCache() });

const count = (value: unknown) => (typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0);

const store = persisted<TokenOptimizationStats>("rusty.tokenOptimizations.stats.v1", empty, (stored) => {
  const raw = (stored ?? {}) as Partial<TokenOptimizationStats>;
  const filters: Record<string, FilterStats> = {};
  for (const [name, value] of Object.entries(raw.filters ?? {})) {
    const v = value as Partial<FilterStats>;
    filters[name] = { runs: count(v.runs), rawChars: count(v.rawChars), shownChars: count(v.shownChars), stored: count(v.stored), recalled: count(v.recalled) };
  }
  const cache = (raw.promptCache ?? {}) as Partial<PromptCacheStats>;
  const misses = (cache.misses ?? {}) as Partial<Record<MissCause, number>>;
  const promptCache: PromptCacheStats = {
    requests: count(cache.requests), followUps: count(cache.followUps), unreported: count(cache.unreported),
    input: count(cache.input), cacheRead: count(cache.cacheRead), cacheWrite: count(cache.cacheWrite),
    misses: { prefix: count(misses.prefix), expired: count(misses.expired), history: count(misses.history) },
  };
  return { since: typeof raw.since === "string" ? raw.since : new Date().toISOString(), filters, refusedModelSwitches: count(raw.refusedModelSwitches), promptCache };
});

const zero: FilterStats = { runs: 0, rawChars: 0, shownChars: 0, stored: 0, recalled: 0 };

function update(filter: string, change: (stats: FilterStats) => FilterStats): void {
  const current = store.get();
  store.set({ ...current, filters: { ...current.filters, [filter]: change(current.filters[filter] ?? zero) } });
}

export function recordCondensed(filter: string, rawChars: number, shownChars: number, stored: boolean): void {
  update(filter, (s) => ({ ...s, runs: s.runs + 1, rawChars: s.rawChars + rawChars, shownChars: s.shownChars + shownChars, stored: s.stored + (stored ? 1 : 0) }));
}

export function recordRecall(filter: string): void {
  update(filter, (s) => ({ ...s, recalled: s.recalled + 1 }));
}

export function recordRefusedModelSwitch(): void {
  const current = store.get();
  store.set({ ...current, refusedModelSwitches: current.refusedModelSwitches + 1 });
}

export function recordCachedRequest(request: CachedRequest): void {
  const current = store.get();
  const c = current.promptCache;
  const followUp = request.followUp ? 1 : 0;
  store.set({
    ...current,
    promptCache: {
      requests: c.requests + 1,
      followUps: c.followUps + followUp,
      unreported: c.unreported + (request.followUp && request.unreported ? 1 : 0),
      input: c.input + request.input,
      cacheRead: c.cacheRead + request.cacheRead,
      cacheWrite: c.cacheWrite + request.cacheWrite,
      misses: request.miss ? { ...c.misses, [request.miss]: c.misses[request.miss] + 1 } : c.misses,
    },
  });
}

export const tokenOptimizationStats = (): TokenOptimizationStats => store.get();

export const resetTokenOptimizationStats = (): void => store.set(empty());

export const subscribeToTokenOptimizationStats = (listener: () => void): (() => void) => store.subscribe(listener);

/** Share of judged follow-up requests that read the previous prompt from the cache, or undefined before any. */
export function cacheHitRate(stats: PromptCacheStats): number | undefined {
  const judged = stats.followUps - stats.unreported;
  if (judged <= 0) return undefined;
  const missed = stats.misses.prefix + stats.misses.expired + stats.misses.history;
  return (judged - missed) / judged;
}

/** Share of kept outputs read back, or undefined before any was kept. */
export const recallRate = (stats: FilterStats): number | undefined => (stats.stored > 0 ? stats.recalled / stats.stored : undefined);
