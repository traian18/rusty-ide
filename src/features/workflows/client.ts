/** Every command the workflows feature calls: the catalog, validation and the file access that saves definitions. */
import { invoke } from "@tauri-apps/api/core";
import type { Issue, JsonObject } from "./model";
import type { WorkflowCatalog } from "./service/workflowCatalogService";

/** Calls a Tauri command by name. The app passes the real bridge; tests pass a fake one. */
export type Invoke = <T>(command: string, args: Record<string, unknown>) => Promise<T>;

export interface WorkflowClient {
  /** Every workflow and profile the workspace can use; the built-ins without a root. */
  catalog(rootPath: string | null): Promise<WorkflowCatalog>;
  /** The workflow listed at `path`, read afresh. */
  catalogWorkflow(rootPath: string | null, path: string): Promise<JsonObject>;
  validateProfile(document: JsonObject, library: JsonObject[]): Promise<Issue[]>;
  validateWorkflow(document: JsonObject, profiles: JsonObject[]): Promise<Issue[]>;
  /** File access the editor uses to read and save definitions. */
  readFile(path: string): Promise<string>;
  writeFile(path: string, content: string): Promise<void>;
  deleteFileOrDir(path: string): Promise<void>;
  createDirectory(path: string): Promise<void>;
}

/** Builds the workflow client on a command bridge. Each method names one Tauri command and its arguments. */
export function createWorkflowClient(call: Invoke): WorkflowClient {
  return {
    catalog: (rootPath) => call("behavior_catalog", { rootPath }),
    catalogWorkflow: (rootPath, path) => call("behavior_catalog_workflow", { rootPath, path }),
    validateProfile: (document, library) => call("behavior_validate_profile", { document, library }),
    validateWorkflow: (document, profiles) => call("behavior_validate_workflow", { document, profiles }),
    readFile: (path) => call("read_file_disk", { path }),
    writeFile: (path, content) => call("write_file_disk", { path, content }),
    deleteFileOrDir: (path) => call("delete_file_or_dir", { path }),
    createDirectory: (path) => call("create_directory", { path }),
  };
}

/** The app's workflow client, backed by the Tauri bridge. */
export const workflowClient: WorkflowClient = createWorkflowClient(invoke);
