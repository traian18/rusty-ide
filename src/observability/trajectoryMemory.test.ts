import { describe, expect, it } from "vitest";

import { TrajectoryMemoryBudget } from "./trajectoryMemory";
import type { RunTrajectory, TrajectoryEntry } from "./trajectoryStore";

function entry(id: string, text = "x".repeat(100)): TrajectoryEntry {
  return { id, timestamp: "2026-10-22T10:00:00Z", source: "ToolCallCompleted", payload: text, payloadState: "full" };
}

function run(id: string, entries: TrajectoryEntry[]): RunTrajectory {
  return {
    id,
    startedAt: "2026-10-22T10:00:00Z",
    origin: { surface: "agent", displayLabel: "Agent" },
    context: { capability: "agent_chat" },
    status: "running",
    entries,
    omittedEntries: 0,
  } as unknown as RunTrajectory;
}

/** What a fresh budget measures for the same runs. */
function recounted(runs: RunTrajectory[]): number {
  const fresh = new TrajectoryMemoryBudget(Number.MAX_SAFE_INTEGER);
  fresh.fit(runs, true);
  return fresh.bytes;
}

describe("TrajectoryMemoryBudget", () => {
  it("keeps its running total equal to a full recount as runs change, appear and disappear", () => {
    const budget = new TrajectoryMemoryBudget(Number.MAX_SAFE_INTEGER);
    let runs = budget.fit([run("a", [entry("a1")]), run("b", [entry("b1"), entry("b2")])]);
    expect(budget.bytes).toBe(recounted(runs));

    runs = budget.fit([run("c", []), { ...runs[0], entries: [...runs[0].entries, entry("a2")] }, runs[1]]);
    expect(budget.bytes).toBe(recounted(runs));

    runs = budget.fit([runs[0], runs[1]]);
    expect(budget.bytes).toBe(recounted(runs));
  });

  it("drops the oldest entries of the oldest run first once over budget, and counts what it dropped", () => {
    const newer = run("newer", [entry("n1"), entry("n2")]);
    const older = run("older", [entry("o1"), entry("o2"), entry("o3")]);
    const limit = recounted([newer, older]) - 150;
    const budget = new TrajectoryMemoryBudget(limit);

    const [keptNewer, keptOlder] = budget.fit([newer, older]);

    expect(keptNewer).toBe(newer);
    expect(keptOlder.entries.map((e) => e.id)).toEqual(["o2", "o3"]);
    expect(keptOlder.omittedEntries).toBe(1);
    expect(budget.bytes).toBeLessThanOrEqual(limit);
    expect(budget.bytes).toBe(recounted([keptNewer, keptOlder]));
  });
});
