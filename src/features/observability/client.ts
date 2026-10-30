/** Every command observability calls: the on-disk run history and the usage summary files. */
import { invoke } from "@tauri-apps/api/core";
import type { DeleteScope, LoadOptions, LoadResult, ObservabilityPersistence, ObservabilityStream } from "./service/persistence";

/** Calls a Tauri command by name. The app passes the real bridge; tests pass a fake one. */
export type Invoke = <T>(command: string, args: Record<string, unknown>) => Promise<T>;

export interface ObservabilityClient extends ObservabilityPersistence {
  readFile(path: string): Promise<string>;
  resetUsageDay(workspaceRoot: string, day: string): Promise<void>;
}

/** Builds the observability client on a command bridge. Each method names one Tauri command and its arguments. */
export function createObservabilityClient(call: Invoke): ObservabilityClient {
  return {
    append: (workspaceRoot: string | undefined, stream: ObservabilityStream, lines: unknown[], runId?: string) =>
      call<void>("observability_append", { workspaceRoot: workspaceRoot ?? null, stream, runId: runId ?? null, lines }),
    load: (workspaceRoot: string | undefined, { sinceDay, limit, trajectoryLimit }: LoadOptions) =>
      call<LoadResult>("observability_load", { workspaceRoot: workspaceRoot ?? null, sinceDay: sinceDay ?? null, limit, trajectoryLimit }),
    loadTrajectory: (workspaceRoot: string | undefined, runId: string) =>
      call<unknown[]>("observability_load_trajectory", { workspaceRoot: workspaceRoot ?? null, runId }),
    delete: (workspaceRoot: string | undefined, scope: DeleteScope) =>
      call<void>("observability_delete", { workspaceRoot: workspaceRoot ?? null, scope }),
    readFile: (path) => call<string>("read_file_disk", { path }),
    resetUsageDay: (workspaceRoot, day) => call<void>("reset_usage_day", { workspaceRoot, day }),
  };
}

export const observabilityClient = createObservabilityClient(invoke);
