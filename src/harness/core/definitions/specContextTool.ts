// ============================================================
// definitions/specContextTool.ts -- "spec_context": the repository's specs, read-only.
//
// Lists the project, the capabilities and the changes (status, progress, next step), or returns one
// change: its status, its open tasks and the documents asked for (spec, design, tasks, ...). It only
// reads files under the specs folder, so it is available under every skill and workflow, like
// repo_context.
// ============================================================

import { specsClient, type SpecsClient } from "../../../specs/client";
import { formatChange, formatSpecList, SPEC_DOCUMENTS } from "../../../specs/chatBrief";
import type { ChangeSummary } from "../../../specs/model";
import type { HostToolHandler } from "../CoreHarness";
import type { HostToolSpec } from "../SessionRecipe";

export const SPEC_CONTEXT_TOOL: HostToolSpec = {
  name: "spec_context",
  description:
    "Read the repository's specs (spec-driven development): with no input, the project file, the capabilities and every change with its status, task progress and next step. With change (a folder name like 0007-photo-albums, its number, or part of its title): that change's status, its open tasks and the documents asked for in documents (any of change, spec, research, design, tasks, verification; default spec and design). The spec says what must be true, the design how it is built, the tasks what is left. Read-only: the spec files are edited with the editor or the spec workflows.",
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

export function specContextTool(workspaceRoot: string, client: SpecsClient = specsClient): HostToolHandler {
  return async (args) => {
    if (!workspaceRoot.trim()) return { ok: false, error: "No workspace is open, so there are no specs to read." };
    try {
      const overview = await client.overview(workspaceRoot);
      const { change: wanted, documents } = (args ?? {}) as { change?: unknown; documents?: unknown };
      if (typeof wanted !== "string" || !wanted.trim()) return { ok: true, output: formatSpecList(overview) };
      const change = findChange(overview.changes, wanted);
      if (!change) {
        const known = overview.changes.map((candidate) => candidate.dir).join(", ") || "none";
        return { ok: false, error: `No change matches "${wanted}". Changes: ${known}.` };
      }
      const names = (Array.isArray(documents) ? documents.filter((name): name is string => typeof name === "string" && name in SPEC_DOCUMENTS) : ["spec", "design"]);
      const base = `${overview.root}/changes/${change.dir}`;
      const tasks = await client.tasks(workspaceRoot, change.dir);
      const wantedDocuments = await Promise.all(
        names.map(async (name) => ({ name, text: await client.document(workspaceRoot, `${base}/${SPEC_DOCUMENTS[name]}`) })),
      );
      return { ok: true, output: formatChange(overview.root, change, tasks, wantedDocuments) };
    } catch (error: unknown) {
      return { ok: false, error: failureText(error) };
    }
  };
}
