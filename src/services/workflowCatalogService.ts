/**
 * workflowCatalogService.ts -- the one list of workflows and behavior
 * profiles a workspace can use.
 *
 * The native host aggregates it on every call (src-tauri/src/harness/catalog.rs):
 * rusty-core's default profile, the app's built-in workflows and profiles
 * (ids under `rusty-ide.builtin.`, paths `builtin:<id>`), and what the user
 * saved in `.rusty/workflows` and `.rusty/profiles`. Choosing a workflow,
 * opening one in the editor and starting a run all read from here, so no
 * caller keeps its own, possibly stale, copy.
 */

import { invoke } from "@tauri-apps/api/core";
import type { JsonObject } from "../components/tabs/behaviors/behaviorModel";

export type CatalogSource = "core" | "builtin" | "workspace";

export interface CatalogEntry {
  /** A saved file's path, `builtin:<id>` for a built-in workflow, the id for a built-in profile. */
  path: string;
  source: CatalogSource;
  document: JsonObject;
}

export interface CatalogFailure {
  path: string;
  error: string;
}

export interface WorkflowCatalog {
  /** Built-in workflows in picker order, then the workspace's. */
  workflows: CatalogEntry[];
  /** The core default, the built-in profiles, then the workspace's. */
  profiles: CatalogEntry[];
  /** Workspace files that could not be read. */
  failures: CatalogFailure[];
  /** What a new workflow starts from. */
  default_workflow: JsonObject;
}

export const workflowCatalogService = {
  /** Everything the workspace at `rootPath` can use (the built-ins without one), read afresh. */
  load(rootPath?: string): Promise<WorkflowCatalog> {
    return invoke<WorkflowCatalog>("behavior_catalog", { rootPath: rootPath ?? null });
  },

  /** The workflow listed at `path`, read afresh; rejects when there is none. */
  workflow(rootPath: string | undefined, path: string): Promise<JsonObject> {
    return invoke<JsonObject>("behavior_catalog_workflow", { rootPath: rootPath ?? null, path });
  },
};

/** Whether `entry` ships with the app (and so is read-only). */
export function isBuiltinEntry(entry: CatalogEntry): boolean {
  return entry.source !== "workspace";
}
