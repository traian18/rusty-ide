// ============================================================
// switches.ts -- whether each optimisation is on, as set on the Settings
// page. Read at the moment an optimisation would act, so a change applies
// from the next command or request on.
// ============================================================

import { TOKEN_OPTIMIZATIONS, type OptimizationId } from "./catalog";
import { persisted } from "./persisted";

type Switches = Record<OptimizationId, boolean>;

const defaults = (): Switches => Object.fromEntries(TOKEN_OPTIMIZATIONS.map((optimization) => [optimization.id, optimization.defaultEnabled])) as Switches;

const store = persisted<Switches>("rusty.tokenOptimizations.switches.v1", defaults, (stored) => {
  const base = defaults();
  if (stored && typeof stored === "object") {
    for (const id of Object.keys(base) as OptimizationId[]) {
      const value = (stored as Record<string, unknown>)[id];
      if (typeof value === "boolean") base[id] = value;
    }
  }
  return base;
});

export const isOptimizationEnabled = (id: OptimizationId): boolean => store.get()[id];

export const optimizationSwitches = (): Readonly<Switches> => store.get();

export function setOptimizationEnabled(id: OptimizationId, enabled: boolean): void {
  store.set({ ...store.get(), [id]: enabled });
}

export const subscribeToOptimizationSwitches = (listener: () => void): (() => void) => store.subscribe(listener);
