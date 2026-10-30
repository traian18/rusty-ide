import { useSyncExternalStore } from "react";
import {
  optimizationSwitches,
  subscribeToOptimizationSwitches,
  subscribeToTokenOptimizationStats,
  tokenOptimizationStats,
} from "../../../harness/core/tokenOptimizations";

/** The token optimisation switches, re-rendering when one changes. */
export const useOptimizationSwitches = () => useSyncExternalStore(subscribeToOptimizationSwitches, optimizationSwitches);

/** What the token optimisations did, re-rendering as commands are condensed and read back. */
export const useTokenOptimizationStats = () => useSyncExternalStore(subscribeToTokenOptimizationStats, tokenOptimizationStats);
