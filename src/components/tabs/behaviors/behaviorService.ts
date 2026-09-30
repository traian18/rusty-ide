/**
 * behaviorService.ts — workspace files and core validation for the
 * Behaviors canvas.
 *
 * Profiles live in `.rusty/profiles/<id>.json` (the directory rusty-core's
 * `SessionBuilder::workspace_profiles` loads, with `config.json` naming the
 * workspace default); workflows in `.rusty/workflows/<id>.json`.
 */

import { invoke } from "@tauri-apps/api/core";
import { type Issue, type Json, type JsonObject, isObject, stableStringify } from "./behaviorModel";

import { BUILTIN_WORKFLOW_PATH, builtinWorkflowDocument, isUnmodifiedStarter } from "./starterFlow";

export const PROFILES_DIR = ".rusty/profiles";
export const WORKFLOWS_DIR = ".rusty/workflows";
export const PROFILES_CONFIG = "config.json";

export interface StoredDocument {
  /** Absolute path of the file, or where it will be written. */
  path: string;
  document: JsonObject;
  /** Serialized form as last read or written, for dirty tracking. */
  saved: string;
}

export interface LoadFailure {
  path: string;
  error: string;
}

export interface Templates {
  builtin_profiles: JsonObject[];
  default_workflow: JsonObject;
}

interface DirectoryEntry {
  name: string;
  path: string;
  is_dir?: boolean;
  isDir?: boolean;
}

async function listJson(dir: string): Promise<DirectoryEntry[]> {
  try {
    const tree = await invoke<DirectoryEntry[]>("get_directory_structure", { rootDir: dir });
    return (tree ?? []).filter((entry) => entry.name.endsWith(".json") && !(entry.is_dir ?? entry.isDir));
  } catch {
    return [];
  }
}

async function loadDir(dir: string, skip: string[] = []) {
  const documents: StoredDocument[] = [];
  const failures: LoadFailure[] = [];
  for (const entry of await listJson(dir)) {
    if (skip.includes(entry.name)) continue;
    try {
      const text = await invoke<string>("read_file_disk", { path: entry.path });
      const document = JSON.parse(text) as Json;
      if (!isObject(document)) throw new Error("not a JSON object");
      documents.push({ path: entry.path, document, saved: stableStringify(document) });
    } catch (error) {
      failures.push({ path: entry.path, error: String(error) });
    }
  }
  return { documents, failures };
}

export function profilePath(rootPath: string, id: string): string {
  return `${rootPath}/${PROFILES_DIR}/${id}.json`;
}

export function workflowPath(rootPath: string, id: string): string {
  return `${rootPath}/${WORKFLOWS_DIR}/${id}.json`;
}

export const behaviorService = {
  loadProfiles(rootPath: string) {
    return loadDir(`${rootPath}/${PROFILES_DIR}`, [PROFILES_CONFIG]);
  },

  async loadWorkflows(rootPath: string) {
    const loaded = await loadDir(`${rootPath}/${WORKFLOWS_DIR}`);
    const documents: StoredDocument[] = [];
    for (const doc of loaded.documents) {
      if (doc.path === workflowPath(rootPath, "plan-build-verify") && isUnmodifiedStarter(doc.document)) {
        // These exact bundled definitions are recoverable from the app. Never
        // remove a customized workflow, even if it uses the starter filename.
        try { await behaviorService.remove(doc.path); }
        catch (error) { loaded.failures.push({ path: doc.path, error: String(error) }); }
      } else documents.push(doc);
    }
    const document = builtinWorkflowDocument();
    return { ...loaded, documents: [{ path: BUILTIN_WORKFLOW_PATH, document, saved: stableStringify(document) }, ...documents] };
  },

  async readWorkflow(path: string): Promise<JsonObject> {
    if (path === BUILTIN_WORKFLOW_PATH) return builtinWorkflowDocument();
    try {
      const document = JSON.parse(await invoke<string>("read_file_disk", { path })) as JsonObject;
      return isUnmodifiedStarter(document) ? builtinWorkflowDocument() : document;
    } catch (error) {
      if (path.replace(/\\/g, "/").endsWith("/.rusty/workflows/plan-build-verify.workflow.json")
        || path.replace(/\\/g, "/").endsWith("/.rusty/workflows/plan-build-verify.json")) return builtinWorkflowDocument();
      throw error;
    }
  },

  /** The workspace default profile id from `config.json`, if any. */
  async loadDefaultProfile(rootPath: string): Promise<string | undefined> {
    try {
      const text = await invoke<string>("read_file_disk", {
        path: `${rootPath}/${PROFILES_DIR}/${PROFILES_CONFIG}`,
      });
      const config = JSON.parse(text) as Json;
      if (isObject(config) && isObject(config.default) && typeof config.default.id === "string") {
        return config.default.id;
      }
    } catch {
      // No config: the built-in default applies.
    }
    return undefined;
  },

  /** Writes `config.json`, keeping any other keys it already has. */
  async saveDefaultProfile(rootPath: string, id: string | undefined): Promise<void> {
    const path = `${rootPath}/${PROFILES_DIR}/${PROFILES_CONFIG}`;
    let config: JsonObject = {};
    try {
      const existing = JSON.parse(await invoke<string>("read_file_disk", { path })) as Json;
      if (isObject(existing)) config = existing;
    } catch {
      // Start fresh.
    }
    if (id) config.default = { id };
    else delete config.default;
    await ensureDir(`${rootPath}/${PROFILES_DIR}`);
    await invoke("write_file_disk", { path, content: stableStringify(config) });
  },

  async save(path: string, document: JsonObject): Promise<string> {
    if (path === BUILTIN_WORKFLOW_PATH) throw new Error("Built-in workflows are read-only");
    await ensureDir(path.slice(0, path.lastIndexOf("/")));
    const content = stableStringify(document);
    await invoke("write_file_disk", { path, content });
    return content;
  },

  async remove(path: string): Promise<void> {
    if (path === BUILTIN_WORKFLOW_PATH) throw new Error("Built-in workflows cannot be deleted");
    await invoke("delete_file_or_dir", { path });
  },

  validateProfile(document: JsonObject, library: JsonObject[]): Promise<Issue[]> {
    return invoke<Issue[]>("behavior_validate_profile", { document, library });
  },

  validateWorkflow(document: JsonObject, profiles: JsonObject[]): Promise<Issue[]> {
    return invoke<Issue[]>("behavior_validate_workflow", { document, profiles });
  },

  templates(): Promise<Templates> {
    return invoke<Templates>("behavior_templates");
  },
};

async function ensureDir(path: string) {
  try {
    await invoke("create_directory", { path });
  } catch {
    // Already exists.
  }
}
