// ============================================================
// checkHistory.ts -- what the IDE learns about a project's checks as they run.
//
// - How long each check took the last time it ran to the end, per project
//   (a full rusty-core test run takes ten minutes; a model cannot know that,
//   and guessing low is how a slow check gets cut off). Kept in the browser's
//   storage so it outlives the app, and in memory when that is unavailable.
// - One check or build command at a time per repository. Two cargo runs in
//   one repository wait on each other's build lock anyway, silently; here the
//   second one waits in the open and says so.
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

// ---- Limits of a long run ----------------------------------------------

/** The most a check, or a command run in the background, may run in all. */
export const LONG_RUN_MAX_MS = 60 * 60_000;
/** How long a command run in the background may print nothing before it is stopped as hung. */
export const LONG_RUN_IDLE_MS = 10 * 60_000;

// ---- One check at a time per repository ---------------------------------

/** The repositories discovered in the open workspace, relative to it ("" for the workspace
 * itself), deepest first: set by the Git discovery the IDE runs anyway. */
let discovered: { root: string; repositories: string[] } = { root: "", repositories: [] };

function normalizedRoot(workspaceRoot: string): string {
  return workspaceRoot.replace(/\\/g, "/").replace(/\/+$/, "");
}

/** Records the repositories found in `workspaceRoot` (their working-tree paths); ones outside
 * it (an external linked worktree) are left out. */
export function setWorkspaceRepositories(workspaceRoot: string, worktreePaths: string[]) {
  const root = normalizedRoot(workspaceRoot);
  const repositories = worktreePaths
    .map((path) => path.replace(/\\/g, "/").replace(/\/+$/, ""))
    .filter((path) => path === root || path.startsWith(`${root}/`))
    .map((path) => (path === root ? "" : path.slice(root.length + 1)))
    .sort((a, b) => b.split("/").length - a.split("/").length);
  discovered = { root, repositories };
}

/**
 * The repository a workspace path belongs to, or "." for the workspace itself. The innermost
 * discovered repository holding it (`services/api` for `services/api/src`, wherever the
 * repositories are grouped); before discovery, or for a path in none, its first folder below
 * the workspace (`rusty-core` for `rusty-core/sdk/typescript`). Checks and build commands take
 * turns per repository, since that is what shares a build directory and its lock.
 */
export function repositoryOf(workspaceRoot: string, path: string): string {
  const root = normalizedRoot(workspaceRoot);
  let relative = path.replace(/\\/g, "/");
  if (relative === root) return ".";
  if (relative.startsWith(`${root}/`)) relative = relative.slice(root.length + 1);
  relative = relative.replace(/^\.\/+/, "").replace(/\/+$/, "");
  if (discovered.root === root) {
    const holder = discovered.repositories.find((repository) => repository && (relative === repository || relative.startsWith(`${repository}/`)));
    if (holder) return holder;
    if (discovered.repositories.includes("")) return ".";
  }
  const first = relative.split("/").find((part) => part && part !== ".");
  return first ?? ".";
}

/** Programs that build or test, and so may hold a repository's build lock for minutes. */
const BUILD_PROGRAMS = new Set([
  "cargo", "npm", "pnpm", "yarn", "bun", "npx", "node", "go", "make", "gradle", "gradlew", "./gradlew", "mvn", "./mvnw",
  "pytest", "python", "python3", "uv", "poetry", "tsc", "vitest", "jest", "dotnet", "swift", "xcodebuild", "terraform",
]);

/** Whether a command builds or tests, and so takes its repository's turn like a check. */
export function takesTurn(program: string): boolean {
  const name = program.split("/").pop() ?? program;
  return BUILD_PROGRAMS.has(program) || BUILD_PROGRAMS.has(name);
}


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
