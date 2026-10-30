import type { RunTrajectory, TrajectoryEntry } from "./trajectoryStore";

// Approximate in-memory guard. JSON string lengths are cached per immutable
// entry; metadata gets a small fixed allowance per run.
const MEMORY_BYTES = 2_000_000;
const RUN_METADATA_BYTES = 512;

const entryBytes = new WeakMap<TrajectoryEntry, number>();
const runBytes = new WeakMap<RunTrajectory, number>();

/** Entry sizes are measured once and cached, so a new event costs one
 * entry's serialization instead of re-serializing every run in memory. */
function sizeOfEntry(entry: TrajectoryEntry): number {
  let size = entryBytes.get(entry);
  if (size === undefined) {
    size = JSON.stringify(entry).length;
    entryBytes.set(entry, size);
  }
  return size;
}

function sizeOfRun(run: RunTrajectory): number {
  let size = runBytes.get(run);
  if (size === undefined) {
    size = RUN_METADATA_BYTES + run.entries.reduce((total, entry) => total + sizeOfEntry(entry), 0);
    runBytes.set(run, size);
  }
  return size;
}

function withoutOldestEntries(run: RunTrajectory, drop: number): RunTrajectory {
  return { ...run, entries: run.entries.slice(drop), omittedEntries: run.omittedEntries + drop };
}

/** Keeps the runs held in memory under a byte budget, dropping the oldest
 * entries of the oldest runs once it is crossed. The total is kept
 * incrementally: it always equals the size of the runs the last `fit`
 * returned, which are the runs it compares the next call against. */
export class TrajectoryMemoryBudget {
  private totalBytes = 0;
  private accountedRuns = new Map<string, RunTrajectory>();

  constructor(private readonly limitBytes = MEMORY_BYTES) {}

  /** The approximate size of the runs the last `fit` returned. */
  get bytes(): number {
    return this.totalBytes;
  }

  /** The runs to keep, trimmed to the budget. `recalculate` measures every
   * run again instead of only the ones that changed. */
  fit(runs: RunTrajectory[], recalculate = false): RunTrajectory[] {
    this.account(runs, recalculate);
    const fitted = this.evict(runs);
    this.accountedRuns = new Map(fitted.map((run) => [run.id, run]));
    return fitted;
  }

  private account(runs: RunTrajectory[], recalculate: boolean) {
    if (recalculate || this.accountedRuns.size === 0) {
      this.totalBytes = runs.reduce((total, run) => total + sizeOfRun(run), 0);
      return;
    }
    const nextIds = new Set(runs.map((run) => run.id));
    for (const [id, previous] of this.accountedRuns) if (!nextIds.has(id)) this.totalBytes -= sizeOfRun(previous);
    for (const run of runs) {
      const previous = this.accountedRuns.get(run.id);
      if (previous !== run) this.totalBytes += sizeOfRun(run) - (previous ? sizeOfRun(previous) : 0);
    }
  }

  /** Only does eviction work when the tracked total crosses the budget;
   * runs are newest first, so the oldest run is trimmed first. */
  private evict(runs: RunTrajectory[]): RunTrajectory[] {
    let fitted = runs;
    for (let index = runs.length - 1; this.totalBytes > this.limitBytes && index >= 0; index--) {
      const drop = this.entriesToDrop(runs[index]);
      if (drop > 0) fitted = fitted.map((run, i) => (i === index ? withoutOldestEntries(run, drop) : run));
    }
    return fitted;
  }

  private entriesToDrop(run: RunTrajectory): number {
    let drop = 0;
    while (drop < run.entries.length && this.totalBytes > this.limitBytes) this.totalBytes -= sizeOfEntry(run.entries[drop++]);
    return drop;
  }
}
