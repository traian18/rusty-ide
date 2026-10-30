import { describe, expect, it } from "vitest";
import { selectStableTurns, type HistoryTurn } from "./stableTurns";

const turn = (chars: number, pinned = false): HistoryTurn => ({ content: "x".repeat(chars), pinned });
const keptIndexes = (turns: HistoryTurn[], budget: number) => selectStableTurns(turns, budget).kept.flatMap((kept, i) => (kept ? [i] : []));

describe("selectStableTurns", () => {
  it("keeps everything under the budget", () => {
    expect(selectStableTurns([turn(10), turn(10)], 100)).toEqual({ kept: [true, true], omitted: 0 });
  });

  it("leaves out the oldest turns in whole steps and fits the budget", () => {
    const turns = Array.from({ length: 10 }, () => turn(100));
    // 1,000 chars over a 700 budget: 300 over, rounded up to two 175-char steps -> four turns out.
    expect(keptIndexes(turns, 700)).toEqual([0, 5, 6, 7, 8, 9]);
    expect(selectStableTurns(turns, 700).omitted).toBe(4);
  });

  it("keeps the same turns out while new turns stay within the step", () => {
    const turns = Array.from({ length: 10 }, () => turn(100));
    const before = keptIndexes(turns, 700).filter((i) => i < 10);
    for (const added of [10, 20, 40]) {
      expect(keptIndexes([...turns, turn(added)], 700).filter((i) => i < 10)).toEqual(before);
    }
    // Crossing the next step boundary (400 over -> three steps, 525 chars) moves the cut once.
    expect(keptIndexes([...turns, turn(100)], 700).filter((i) => i < 10)).toEqual([0, 7, 8, 9]);
  });

  it("never leaves out the opening request, a pinned turn or the latest turn", () => {
    const turns = [turn(500), turn(100, true), turn(100), turn(500)];
    expect(keptIndexes(turns, 300)).toEqual([0, 1, 3]);
  });
});
