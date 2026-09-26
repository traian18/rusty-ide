import { invoke } from "@tauri-apps/api/core";

export type ObservabilityStream = "executions" | "trajectory-index" | "trajectory-entries";

export type DeleteScope =
  | { kind: "all" }
  | { kind: "execution"; id: string }
  | { kind: "session"; id: string }
  | { kind: "run"; id: string };

export interface LoadOptions {
  sinceDay?: string;
  limit: number;
  trajectoryLimit: number;
}

export interface LoadResult {
  executions: unknown[];
  trajectories: unknown[];
  bytes: number;
}

/** `workspaceRoot` undefined = app-level history for runs outside any workspace. */
export interface ObservabilityPersistence {
  append(workspaceRoot: string | undefined, stream: ObservabilityStream, lines: unknown[], runId?: string): Promise<void>;
  load(workspaceRoot: string | undefined, options: LoadOptions): Promise<LoadResult>;
  loadTrajectory(workspaceRoot: string | undefined, runId: string): Promise<unknown[]>;
  delete(workspaceRoot: string | undefined, scope: DeleteScope): Promise<void>;
}

export const tauriPersistence: ObservabilityPersistence = {
  append: (workspaceRoot, stream, lines, runId) =>
    invoke("observability_append", { workspaceRoot: workspaceRoot ?? null, stream, runId: runId ?? null, lines }),
  load: (workspaceRoot, { sinceDay, limit, trajectoryLimit }) =>
    invoke<LoadResult>("observability_load", { workspaceRoot: workspaceRoot ?? null, sinceDay: sinceDay ?? null, limit, trajectoryLimit }),
  loadTrajectory: (workspaceRoot, runId) =>
    invoke<unknown[]>("observability_load_trajectory", { workspaceRoot: workspaceRoot ?? null, runId }),
  delete: (workspaceRoot, scope) =>
    invoke("observability_delete", { workspaceRoot: workspaceRoot ?? null, scope }),
};

type Row = Record<string, unknown>;

function fold(lines: Row[]): Row[] {
  const latest = new Map<string, Row>();
  for (const line of lines) {
    if (typeof line.id === "string") {
      latest.delete(line.id);
      latest.set(line.id, line);
    }
  }
  return [...latest.values()];
}

/** Same semantics as `observability_store.rs`, kept in memory (tests, plain-browser dev). */
export function createMemoryPersistence(): ObservabilityPersistence & { roots: Map<string, MemoryRoot> } {
  const roots = new Map<string, MemoryRoot>();
  const rootFor = (workspaceRoot: string | undefined) => {
    const key = workspaceRoot ?? "";
    let root = roots.get(key);
    if (!root) {
      root = { executions: [], index: [], entries: new Map(), deleted: { executions: new Set(), sessions: new Set(), runs: new Set() } };
      roots.set(key, root);
    }
    return root;
  };
  const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));
  return {
    roots,
    async append(workspaceRoot, stream, lines, runId) {
      const root = rootFor(workspaceRoot);
      const rows = clone(lines) as Row[];
      if (stream === "executions") root.executions.push(...rows);
      else if (stream === "trajectory-index") root.index.push(...rows);
      else {
        if (!runId) throw new Error("invalid or missing run id");
        root.entries.set(runId, [...(root.entries.get(runId) ?? []), ...rows]);
      }
    },
    async load(workspaceRoot, { sinceDay, limit, trajectoryLimit }) {
      const root = rootFor(workspaceRoot);
      const day = (value: unknown) => (typeof value === "string" ? value.slice(0, 10) : "");
      const inWindow = (value: unknown) => !sinceDay || day(value) >= sinceDay;
      const executions = fold(root.executions)
        .filter((row) => inWindow(row.requestedAt)
          && !root.deleted.executions.has(String(row.id))
          && !root.deleted.sessions.has(String(row.sessionId)))
        .sort((a, b) => String(b.requestedAt).localeCompare(String(a.requestedAt)))
        .slice(0, limit);
      const trajectories = fold(root.index)
        .filter((row) => inWindow(row.startedAt)
          && !root.deleted.runs.has(String(row.id))
          && !root.deleted.sessions.has(String(row.sessionId)))
        .sort((a, b) => String(b.startedAt).localeCompare(String(a.startedAt)))
        .slice(0, trajectoryLimit);
      const bytes = JSON.stringify([root.executions, root.index, [...root.entries.values()]]).length;
      return clone({ executions, trajectories, bytes });
    },
    async loadTrajectory(workspaceRoot, runId) {
      return clone(rootFor(workspaceRoot).entries.get(runId) ?? []);
    },
    async delete(workspaceRoot, scope) {
      const root = rootFor(workspaceRoot);
      if (scope.kind === "all") {
        roots.delete(workspaceRoot ?? "");
      } else if (scope.kind === "execution") {
        root.deleted.executions.add(scope.id);
      } else if (scope.kind === "session") {
        root.deleted.sessions.add(scope.id);
        for (const run of fold(root.index)) if (run.sessionId === scope.id) root.entries.delete(String(run.id));
      } else {
        root.deleted.runs.add(scope.id);
        root.entries.delete(scope.id);
      }
    },
  };
}

interface MemoryRoot {
  executions: Row[];
  index: Row[];
  entries: Map<string, Row[]>;
  deleted: { executions: Set<string>; sessions: Set<string>; runs: Set<string> };
}

export function defaultPersistence(): ObservabilityPersistence {
  return typeof globalThis === "object" && "__TAURI_INTERNALS__" in globalThis ? tauriPersistence : createMemoryPersistence();
}

const RETENTION_KEY = "rusty.execution-observability.retention.v1";
export type RetentionDays = 7 | 30 | 90 | null;

export function readRetentionPreference(): RetentionDays {
  try {
    const value = globalThis.localStorage?.getItem(RETENTION_KEY);
    return value === "7" || value === "30" || value === "90" ? Number(value) as 7 | 30 | 90 : value === "unlimited" ? null : 30;
  } catch {
    return 30;
  }
}

export function writeRetentionPreference(days: RetentionDays): void {
  try {
    globalThis.localStorage?.setItem(RETENTION_KEY, days === null ? "unlimited" : String(days));
  } catch {
    // Only the view window; history on disk is unaffected.
  }
}

/** Reads and removes a pre-disk localStorage history key; undefined when absent. */
export function takeLegacyItem(key: string): { raw: string; remove: () => void } | undefined {
  try {
    const storage = globalThis.localStorage;
    const raw = storage?.getItem(key);
    return raw ? { raw, remove: () => { try { storage!.removeItem(key); } catch { /* already gone */ } } } : undefined;
  } catch {
    return undefined;
  }
}

export function sinceDayFor(retentionDays: number | null, now = Date.now()): string | undefined {
  return retentionDays === null ? undefined : new Date(now - retentionDays * 86_400_000).toISOString().slice(0, 10);
}
