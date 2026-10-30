// ============================================================
// history/stableTurns.ts -- which earlier chat turns to send, chosen so
// the prompt prefix stays the same from one turn to the next.
//
// A provider bills a cached prefix at a fraction of the price, but only
// while it is byte-identical. Choosing "the newest turns that fit" on
// every turn moves the cut each time a turn is added, so every request
// starts differently. Here the cut moves in steps: the characters to
// leave out are rounded up to a whole number of steps (a quarter of the
// budget), and the oldest turns that cover them are left out. Until the
// overflow crosses the next step boundary, the same turns are left out
// and every request starts the same way.
//
// A pure function of the turns' contents: no clock, no counter, no
// memory of earlier calls. The opening request, pinned turns and the
// latest turn are never left out, as with the plain selection.
// ============================================================

export interface HistoryTurn {
  content: string;
  pinned: boolean;
}

export interface TurnSelection {
  kept: boolean[];
  omitted: number;
}

/** Share of the budget the cut moves by. */
export const CUT_STEP_SHARE = 0.25;

export function selectStableTurns(turns: readonly HistoryTurn[], budgetChars: number): TurnSelection {
  const total = turns.reduce((sum, turn) => sum + turn.content.length, 0);
  const kept = turns.map(() => true);
  if (total <= budgetChars) return { kept, omitted: 0 };
  const step = Math.max(1, Math.floor(budgetChars * CUT_STEP_SHARE));
  const cut = Math.ceil((total - budgetChars) / step) * step;
  let leftOut = 0;
  for (let index = 1; index < turns.length - 1 && leftOut < cut; index += 1) {
    if (turns[index].pinned) continue;
    kept[index] = false;
    leftOut += turns[index].content.length;
  }
  return { kept, omitted: kept.filter((flag) => !flag).length };
}
