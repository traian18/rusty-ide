// ============================================================
// stats.ts -- what the optimisations did, kept across app restarts until
// reset: per command filter, how much output came in and went out, how
// many full outputs were kept and how many of those the model read back
// (the recall rate: a filter that is often read back leaves out too
// much), and how many model switches the warm-cache guard refused.
// ============================================================

import { persisted } from "./persisted";

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

export interface TokenOptimizationStats {
  /** ISO time the counting started. */
  since: string;
  filters: Record<string, FilterStats>;
  refusedModelSwitches: number;
}

const empty = (): TokenOptimizationStats => ({ since: new Date().toISOString(), filters: {}, refusedModelSwitches: 0 });

const count = (value: unknown) => (typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0);

const store = persisted<TokenOptimizationStats>("rusty.tokenOptimizations.stats.v1", empty, (stored) => {
  const raw = (stored ?? {}) as Partial<TokenOptimizationStats>;
  const filters: Record<string, FilterStats> = {};
  for (const [name, value] of Object.entries(raw.filters ?? {})) {
    const v = value as Partial<FilterStats>;
    filters[name] = { runs: count(v.runs), rawChars: count(v.rawChars), shownChars: count(v.shownChars), stored: count(v.stored), recalled: count(v.recalled) };
  }
  return { since: typeof raw.since === "string" ? raw.since : new Date().toISOString(), filters, refusedModelSwitches: count(raw.refusedModelSwitches) };
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

export const tokenOptimizationStats = (): TokenOptimizationStats => store.get();

export const resetTokenOptimizationStats = (): void => store.set(empty());

export const subscribeToTokenOptimizationStats = (listener: () => void): (() => void) => store.subscribe(listener);

/** Share of kept outputs read back, or undefined before any was kept. */
export const recallRate = (stats: FilterStats): number | undefined => (stats.stored > 0 ? stats.recalled / stats.stored : undefined);
