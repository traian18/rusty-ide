// ============================================================
// checkHistory.ts -- what the IDE learns about a project's checks as they run.
//
// - How long each check took the last time it ran to the end, per project
//   (a full rusty-core test run takes ten minutes; a model cannot know that,
//   and guessing low is how a slow check gets cut off). Kept in the browser's
//   storage so it outlives the app, and in memory when that is unavailable.
// - One check at a time per project. Two cargo runs in one project wait on
//   each other's build lock anyway, silently; here the second one waits in
//   the open and says so.
// ============================================================

const STORAGE_KEY = "rusty.checkDurations";

/** Which check, of which project, run whole or narrowed to some tests. */
export interface CheckKey {
  workspaceRoot: string;
  project: string;
  check: string;
  /** The narrowing ("test_name ..."), when only some tests were run. */
  only?: string;
}

const keyOf = (key: CheckKey) => [key.workspaceRoot, key.project, key.check, key.only ?? ""].join("\u0000");

let memory: Record<string, number> | undefined;

function load(): Record<string, number> {
  if (memory) return memory;
  try {
    const stored = globalThis.localStorage?.getItem(STORAGE_KEY);
    memory = stored ? (JSON.parse(stored) as Record<string, number>) : {};
  } catch {
    memory = {};
  }
  return memory;
}

/** How long the check took the last time it ran to the end, in ms. */
export function lastDuration(key: CheckKey): number | undefined {
  const value = load()[keyOf(key)];
  return typeof value === "number" && value > 0 ? value : undefined;
}

/** Remembers a run that ran to the end (passed or failed); a stopped run says nothing about its length. */
export function recordDuration(key: CheckKey, durationMs: number): void {
  const durations = load();
  durations[keyOf(key)] = Math.max(1, Math.round(durationMs));
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(durations));
  } catch {
    // Kept in memory for this session only.
  }
}

/** "10m31s", "42s". */
export function formatDuration(ms: number): string {
  const total = Math.round(ms / 1000);
  return total >= 60 ? `${Math.floor(total / 60)}m${String(total % 60).padStart(2, "0")}s` : `${total}s`;
}

// ---- One check at a time per project ------------------------------------

const queues = new Map<string, Promise<void>>();

export interface ProjectTurn {
  /** How long it waited for the checks ahead of it. */
  waitedMs: number;
  release: () => void;
}

/**
 * Waits until no other check of this project is running, then holds the
 * project until `release`. `onWait` is told once when it has to wait. An
 * abort while waiting rejects, and the check behind it is not held up.
 */
export async function takeProjectTurn(workspaceRoot: string, project: string, signal: AbortSignal, onWait?: () => void): Promise<ProjectTurn> {
  const key = `${workspaceRoot}\u0000${project}`;
  const ahead = queues.get(key) ?? Promise.resolve();
  let release!: () => void;
  const mine = new Promise<void>((resolve) => { release = resolve; });
  // Whatever happens to this check, the one after it waits for it only.
  const chained = ahead.then(() => mine);
  queues.set(key, chained);
  void chained.then(() => {
    if (queues.get(key) === chained) queues.delete(key);
  });

  const started = Date.now();
  let free = false;
  void ahead.then(() => { free = true; });
  await Promise.resolve();
  if (!free) onWait?.();
  try {
    await new Promise<void>((resolve, reject) => {
      if (signal.aborted) return reject(new Error("cancelled while waiting for another check"));
      const onAbort = () => reject(new Error("cancelled while waiting for another check"));
      signal.addEventListener("abort", onAbort, { once: true });
      void ahead.then(() => {
        signal.removeEventListener("abort", onAbort);
        resolve();
      });
    });
  } catch (error) {
    release();
    throw error;
  }
  return { waitedMs: Date.now() - started, release };
}

/** For tests: forget everything learned and queued. */
export function resetCheckHistory(): void {
  memory = {};
  queues.clear();
  try {
    globalThis.localStorage?.removeItem(STORAGE_KEY);
  } catch {
    // Nothing stored.
  }
}
