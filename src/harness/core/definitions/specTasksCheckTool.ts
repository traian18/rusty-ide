// ============================================================
// definitions/specTasksCheckTool.ts -- spec_tasks_check: a task list about to become a change's
// tasks.md, checked against its spec.md by the host (harness-specs `check_task_list`): every
// criterion named by a task, no id that is not in the spec, no cycle, every task naming a
// criterion. Offered only to a Design & tasks run of a change; the Tasks step's completion gate
// calls it with the step's reply, so a task list with gaps goes back to the step instead of
// being saved with warnings.
// ============================================================

import { invoke } from "@tauri-apps/api/core";

import type { SpecWarning } from "../../../specs/model";
import type { HostToolHandler } from "../CoreHarness";
import type { HostToolSpec } from "../SessionRecipe";

export const SPEC_TASKS_CHECK_TOOL: HostToolSpec = {
  name: "spec_tasks_check",
  description:
    "Checks a task list (the complete tasks.md text) against the change's spec.md before it is saved: every criterion must be named by a task, every task must name at least one criterion, ids must exist in the spec and the `after` links must not form a cycle. Ranges such as C1–C3 count every id in them. Returns what to fix, or ok.",
  input_schema: {
    type: "object",
    properties: { tasks: { type: "string", description: "The whole task list, as it would be saved." } },
    required: ["tasks"],
  },
};

/** The change a run plans: its specs folder and change folder. */
export interface PlannedChange {
  root: string;
  change: string;
}

function describe(warning: SpecWarning): string {
  const where = warning.line ? ` (${warning.file.split("/").pop()} line ${warning.line})` : "";
  return `- ${warning.message}${where}`;
}

export function specTasksCheckTool(change: PlannedChange): HostToolHandler {
  return async (args) => {
    const tasks = String((args as { tasks?: unknown } | undefined)?.tasks ?? "");
    try {
      const warnings = await invoke<SpecWarning[]>("specs_tasks_check", { root: change.root, change: change.change, tasks });
      const blocking = warnings.filter((warning) => warning.severity !== "note");
      if (blocking.length === 0) return { ok: true, output: "The task list covers every criterion of the spec." };
      return {
        ok: false,
        error: `The task list does not match spec.md yet. Fix each point and reply with the whole corrected task list (it is saved as tasks.md):\n${blocking.map(describe).join("\n")}`,
      };
    } catch (error: unknown) {
      // A check that cannot run must not hold the plan back; the Specs page still shows warnings.
      return { ok: true, output: `The task list could not be checked: ${error instanceof Error ? error.message : String(error)}` };
    }
  };
}
