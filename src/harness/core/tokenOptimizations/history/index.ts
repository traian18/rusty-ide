// ============================================================
// history/index.ts -- the "Cache-friendly chat history" optimisation as
// callers use it: stepped selection when it is on, the caller's own plain
// selection when it is off or fails.
// ============================================================

import { failOpen } from "../safeguards/guards";
import { isOptimizationEnabled } from "../switches";
import { selectStableTurns, type HistoryTurn, type TurnSelection } from "./stableTurns";

export type { HistoryTurn, TurnSelection };

export function chooseHistoryTurns<T extends HistoryTurn>(
  turns: readonly T[],
  budgetChars: number,
  plain: (turns: T[], budgetChars: number) => TurnSelection,
): TurnSelection {
  if (!isOptimizationEnabled("stable-history")) return plain([...turns], budgetChars);
  return failOpen(() => selectStableTurns(turns, budgetChars), plain([...turns], budgetChars));
}
