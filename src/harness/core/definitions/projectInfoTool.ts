// ============================================================
// definitions/projectInfoTool.ts -- "project_info": tells a model what kind of
// project(s) the workspace holds and how to check them, so it stops guessing
// whether to run `npm test`, `cargo test` or `pytest` and can tell a build
// that fails for a missing dependency from one that fails for a code bug.
//
// The analysis itself is projectInfo.ts (pure, tested against fake trees).
// This file is the glue: a bounded directory scan through the same
// `list_directory` command `list_files` uses, manifest reads through the
// run's host (the same VFS-aware reader `read_file` uses), and an existence
// check for folders the scan deliberately skips, such as node_modules.
// ============================================================

import type { RunHost } from "../../contract";
import type { HostToolHandler } from "../CoreHarness";
import { normalizeBase } from "../fileListing";
import { analyzeProject, focusProjects, formatProjectInfo } from "../projectInfo";
import { scanProject } from "../projectScan";
import type { HostToolSpec } from "../SessionRecipe";

export const PROJECT_INFO_TOOL: HostToolSpec = {
  name: "project_info",
  description:
    "Find out what kind of project the workspace holds and how to check it, without guessing. Returns, for each project found: languages and frameworks, the package manager, the exact install, typecheck, lint, test and build commands (taken from package.json scripts, Cargo, pyproject, go.mod, Makefile and CI workflows), how to start dev servers, and whether dependencies are installed. Call it before running any build, test or verification, and again with path to focus on one project in a monorepo. Run its install, typecheck, lint, test and build checks with run_check; run anything else with run_command, passing program and args separately and the cwd it shows.",
  input_schema: {
    type: "object",
    properties: {
      path: { type: "string", description: "Limit the answer to the project at or containing this directory, relative to the workspace root. Omit to see every project." },
    },
    required: [],
  },
};

export function projectInfoTool(workspaceRoot: string, host: RunHost): HostToolHandler {
  return async (args, signal) => {
    if (!workspaceRoot.trim()) return { ok: false, error: "No workspace is open, so there is no project to inspect." };
    const given = (args as { path?: unknown } | undefined)?.path;
    const base = normalizeBase(typeof given === "string" ? given : "");
    try {
      const info = await analyzeProject(await scanProject(workspaceRoot, host, signal));
      if (base === "") return { ok: true, output: formatProjectInfo(info) };
      const focused = focusProjects(info, base);
      if (focused.projects.length === 0) {
        return { ok: true, output: `No project found at or above '${base}'. Call project_info without path to see every project in the workspace.` };
      }
      return { ok: true, output: formatProjectInfo(focused) };
    } catch (error: unknown) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  };
}
