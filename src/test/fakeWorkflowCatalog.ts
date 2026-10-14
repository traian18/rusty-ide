/**
 * A stand-in for the native workflow catalog (src-tauri/src/harness/catalog.rs)
 * in jsdom tests, answering `behavior_catalog` and `behavior_catalog_workflow`
 * from an in-memory workspace (`files`: path → content) the way the host
 * does: built-ins first, then the workspace's files by path.
 */
import catalog from "../components/tabs/behaviors/starter/catalog.json";
import type { JsonObject } from "../components/tabs/behaviors/behaviorModel";
import type { CatalogEntry, WorkflowCatalog } from "../services/workflowCatalogService";

/** The built-in workflows, as the catalog lists them. */
export const BUILTIN_WORKFLOWS = catalog.workflows as unknown as JsonObject[];
/** Plan, build, verify, the first built-in. */
export const BUILTIN_WORKFLOW = BUILTIN_WORKFLOWS[0];
/** The built-in profiles, as the catalog lists them. */
export const BUILTIN_PROFILES = catalog.profiles as unknown as JsonObject[];
export const CORE_DEFAULT_PROFILE: JsonObject = { schema_version: 1, id: "rusty.default", revision: 1, name: "Default" };
export const DEFAULT_WORKFLOW: JsonObject = { schema_version: 1, id: "rusty.single", nodes: [], edges: [] };

const BUILTIN_ID_PREFIX = "rusty-ide.builtin.";

function workspaceEntries(files: Record<string, string>, dir: string, skip: string[] = []) {
  const entries: CatalogEntry[] = [];
  const failures: WorkflowCatalog["failures"] = [];
  const paths = Object.keys(files)
    .filter((path) => path.startsWith(`${dir}/`) && !path.slice(dir.length + 1).includes("/") && path.endsWith(".json"))
    .filter((path) => !skip.includes(path.slice(dir.length + 1)))
    .sort();
  for (const path of paths) {
    try {
      const document = JSON.parse(files[path]) as unknown;
      if (!document || typeof document !== "object" || Array.isArray(document)) throw new Error("not a JSON object");
      entries.push({ path, source: "workspace", document: document as JsonObject });
    } catch (error) {
      failures.push({ path, error: String(error) });
    }
  }
  return { entries, failures };
}

/** What the host lists for the workspace at `rootPath` holding `files`. */
export function fakeCatalog(files: Record<string, string>, rootPath?: string | null): WorkflowCatalog {
  const workflows = BUILTIN_WORKFLOWS.map((document): CatalogEntry => ({
    path: `builtin:${String(document.id).slice(BUILTIN_ID_PREFIX.length)}`,
    source: "builtin",
    document,
  }));
  const profiles: CatalogEntry[] = [
    { path: String(CORE_DEFAULT_PROFILE.id), source: "core", document: CORE_DEFAULT_PROFILE },
    ...BUILTIN_PROFILES.map((document): CatalogEntry => ({ path: String(document.id), source: "builtin", document })),
  ];
  const failures: WorkflowCatalog["failures"] = [];
  if (rootPath) {
    const saved = workspaceEntries(files, `${rootPath}/.rusty/workflows`);
    const own = workspaceEntries(files, `${rootPath}/.rusty/profiles`, ["config.json"]);
    workflows.push(...saved.entries);
    profiles.push(...own.entries);
    failures.push(...saved.failures, ...own.failures);
  }
  return { workflows, profiles, failures, default_workflow: DEFAULT_WORKFLOW };
}

/** Whether `command` is one the catalog answers. */
export function isCatalogCommand(command: string): boolean {
  return command === "behavior_catalog" || command === "behavior_catalog_workflow";
}

/** The host's answer to a catalog command over `files`; throws like the host when a workflow is missing. */
export function answerCatalogCommand(files: Record<string, string>, command: string, args: Record<string, unknown>): unknown {
  const listed = fakeCatalog(files, args.rootPath as string | null | undefined);
  if (command === "behavior_catalog") return listed;
  const entry = listed.workflows.find((candidate) => candidate.path === args.path);
  if (!entry) throw new Error(`No workflow at ${String(args.path)}`);
  return entry.document;
}
