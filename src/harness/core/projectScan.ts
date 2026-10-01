// ============================================================
// projectScan.ts -- reads a real workspace into the `ProjectFs` the analysis
// in projectInfo.ts works from: a bounded directory scan through the same
// `list_directory` command `list_files` uses, manifest reads through the
// run's host (the VFS-aware reader `read_file` uses), and an existence check
// for folders the scan deliberately skips, such as node_modules. Shared by
// `project_info` and `run_check`, which must agree on what the project is.
// ============================================================

import { invoke } from "@tauri-apps/api/core";

import type { RunHost } from "../contract";
import { resolveWorkspacePath, type ListingEntry, type ListingResult } from "./fileListing";
import type { ProjectFs } from "./projectInfo";

/** Folders to look inside: deep enough to find a monorepo's packages and CI files. */
export const SCAN_DEPTH = 4;

function flatten(entries: ListingEntry[], prefix = ""): string[] {
  const files: string[] = [];
  for (const entry of entries) {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.is_dir) files.push(...flatten(entry.children ?? [], path));
    else files.push(path);
  }
  return files;
}

export async function scanProject(workspaceRoot: string, host: RunHost, signal: AbortSignal): Promise<ProjectFs> {
  const listing = await invoke<ListingResult>("list_directory", { path: workspaceRoot, depth: SCAN_DEPTH });
  const absolute = (path: string) => resolveWorkspacePath(workspaceRoot, path);
  return {
    files: flatten(listing.entries),
    incomplete: listing.truncated,
    // A missing file rejects; the analysis treats that as "not there".
    read: (path) => host.readFile(absolute(path), signal),
    exists: async (path) => {
      try {
        return (await invoke<{ exists: boolean }>("check_external_path", { path: absolute(path) })).exists === true;
      } catch {
        return false;
      }
    },
  };
}
