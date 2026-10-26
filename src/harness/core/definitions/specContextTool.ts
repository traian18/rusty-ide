// ============================================================
// definitions/specContextTool.ts -- "spec_context": the repository's specs, read-only.
//
// Lists the project, the capabilities and the changes (status, progress, next step), or returns one
// change: its status, its open tasks and the documents asked for (spec, design, tasks, ...). It only
// reads files under the specs folder, so it is available under every skill and workflow, like
// repo_context.
// ============================================================

import { invoke } from "@tauri-apps/api/core";
import { specsClient, type SpecsClient } from "../../../specs/client";
import { formatChange, formatSpecList, SPEC_DOCUMENTS } from "../../../specs/chatBrief";
import type { ChangeSummary, SpecsOverview } from "../../../specs/model";
import type { HostToolHandler } from "../CoreHarness";
import type { HostToolSpec } from "../SessionRecipe";

export const SPEC_CONTEXT_TOOL: HostToolSpec = {
  name: "spec_context",
  description:
    "Read the repository's specs (spec-driven development): with no input, the project file, the capabilities and every change with its status, task progress and next step. With change (a folder name like 0007-photo-albums, its number, or part of its title): that change's status, its open tasks and the documents asked for in documents (any of change, spec, checklist, research, design, tasks, verification; default spec and design). The spec says what must be true, the checklist which quality questions about it are still open, the design how it is built, the tasks what is left. Read-only: the spec files are edited with the editor or the spec workflows.",
  input_schema: {
    type: "object",
    properties: {
      change: { type: "string", description: "A change folder name, its number, or part of its title." },
      documents: { type: "array", items: { type: "string", enum: Object.keys(SPEC_DOCUMENTS) }, description: "Which documents to include; default spec and design." },
    },
    required: [],
  },
};

/** The line the system prompts show for the tool. */
export const SPEC_CONTEXT_GUIDE =
  "- 'spec_context': Read the repository's specs: no input lists the project, capabilities and changes; {\"change\": \"0007-photo-albums\", \"documents\"?: [\"spec\", \"design\", \"tasks\"]} returns one change with its open tasks. Read-only.";

function failureText(error: unknown): string {
  if (typeof error === "object" && error !== null && "message" in error) return String((error as { message: unknown }).message);
  return String(error);
}

/** The change a name refers to: its folder, its number, or a part of its title. */
export function findChange(changes: readonly ChangeSummary[], wanted: string): ChangeSummary | undefined {
  const name = wanted.trim().toLowerCase();
  if (!name) return undefined;
  const digits = /^\d+$/.test(name) ? Number(name) : null;
  return (
    changes.find((change) => change.dir.toLowerCase() === name) ??
    (digits === null ? undefined : changes.find((change) => change.number === digits)) ??
    changes.find((change) => change.title.toLowerCase().includes(name) || change.dir.toLowerCase().includes(name))
  );
}

/** A folder directly inside the workspace. */
export interface WorkspaceFolder {
  name: string;
  path: string;
}

/** The folders directly inside `root`, through the same bounded listing `list_files` uses. */
async function listFolders(root: string): Promise<WorkspaceFolder[]> {
  const listing = await invoke<{ entries: Array<{ name: string; path: string; is_dir: boolean }> }>("list_directory", { path: root, depth: 1 });
  return listing.entries.filter((entry) => entry.is_dir && !entry.name.startsWith(".") && entry.name !== "node_modules").map(({ name, path }) => ({ name, path }));
}

interface SpecRoot extends WorkspaceFolder {
  overview: SpecsOverview;
}

function hasSpecs(overview: SpecsOverview): boolean {
  return overview.exists || overview.changes.length > 0;
}

/** Where the specs are: the workspace folder's own (a repository's `specs/`, or a workspace's
 * `.rusty/specs`) and those of each folder directly inside it. `name` is "" for the workspace
 * folder itself. */
async function specRoots(workspaceRoot: string, client: SpecsClient, folders: (root: string) => Promise<WorkspaceFolder[]>): Promise<SpecRoot[]> {
  const own = await client.overview(workspaceRoot);
  const found = await Promise.all(
    (await folders(workspaceRoot).catch(() => [])).map(async (folder) => ({ ...folder, overview: await client.overview(folder.path).catch(() => undefined) })),
  );
  const inside = found.filter((root): root is SpecRoot => root.overview !== undefined && hasSpecs(root.overview));
  const ownRoot = { name: "", path: workspaceRoot, overview: own };
  if (!inside.length) return [ownRoot];
  return hasSpecs(own) ? [ownRoot, ...inside] : inside;
}

/** The specs folder as the workspace sees it: inside its repository when there are several. */
function shownRoot(root: SpecRoot): string {
  return root.name ? `${root.name}/${root.overview.root}` : root.overview.root;
}

export function specContextTool(workspaceRoot: string, client: SpecsClient = specsClient, folders: (root: string) => Promise<WorkspaceFolder[]> = listFolders): HostToolHandler {
  return async (args) => {
    if (!workspaceRoot.trim()) return { ok: false, error: "No workspace is open, so there are no specs to read." };
    try {
      const roots = await specRoots(workspaceRoot, client, folders);
      const { change: given, documents } = (args ?? {}) as { change?: unknown; documents?: unknown };
      if (typeof given !== "string" || !given.trim()) {
        if (roots.length === 1 && !roots[0].name) return { ok: true, output: formatSpecList(roots[0].overview) };
        return { ok: true, output: roots.map((root) => `## ${root.name || "workspace"}\n${formatSpecList({ ...root.overview, root: shownRoot(root) })}`).join("\n\n") };
      }
      // "rusty-ide/0001-x" names the repository as well as the change.
      const [first, ...rest] = given.trim().split("/");
      const named = rest.length ? roots.filter((root) => root.name === first) : [];
      const wanted = named.length ? rest.join("/") : given;
      const matches = (named.length ? named : roots).flatMap((root) => {
        const change = findChange(root.overview.changes, wanted);
        return change ? [{ root, change }] : [];
      });
      if (!matches.length) {
        const known = roots.flatMap((root) => root.overview.changes.map((candidate) => (root.name ? `${root.name}/${candidate.dir}` : candidate.dir))).join(", ") || "none";
        return { ok: false, error: `No change matches "${given}". Changes: ${known}.` };
      }
      const names = (Array.isArray(documents) ? documents.filter((name): name is string => typeof name === "string" && name in SPEC_DOCUMENTS) : ["spec", "design"]);
      const outputs = await Promise.all(
        matches.map(async ({ root, change }) => {
          const base = `${root.overview.root}/changes/${change.dir}`;
          const tasks = await client.tasks(root.path, change.dir);
          const wantedDocuments = await Promise.all(
            names.map(async (name) => ({ name, text: await client.document(root.path, `${base}/${SPEC_DOCUMENTS[name]}`) })),
          );
          return formatChange(shownRoot(root), change, tasks, wantedDocuments);
        }),
      );
      return { ok: true, output: outputs.join("\n\n") };
    } catch (error: unknown) {
      return { ok: false, error: failureText(error) };
    }
  };
}
