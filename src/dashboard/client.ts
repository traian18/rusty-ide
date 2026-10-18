/** The dashboard's window to Tauri: the architecture client (open, refresh, freshness) plus the dashboard commands. */
import { invoke } from "@tauri-apps/api/core";

import { tauriClient, type ArchitectureClient } from "../architecture/client";
import type { FileDetail, FilesPage, FilesQuery, MapFiles } from "./model";

export interface DashboardClient extends ArchitectureClient {
  /** Every file, for the map of the whole repository. */
  allFiles(root: string): Promise<MapFiles>;
  files(root: string, query: FilesQuery): Promise<FilesPage>;
  file(root: string, file: string): Promise<FileDetail>;
  /** The text "Copy fix prompt" copies, for a file or one finding in it. */
  prompt(root: string, file: string, finding?: string): Promise<string>;
}

export const dashboardClient: DashboardClient = {
  ...tauriClient,
  allFiles: (root) => invoke<MapFiles>("repository_dashboard_all_files", { root }),
  files: (root, query) => invoke<FilesPage>("repository_dashboard_files", { root, query }),
  file: (root, file) => invoke<FileDetail>("repository_dashboard_file", { root, file }),
  prompt: (root, file, finding) => invoke<string>("repository_dashboard_prompt", { root, file, finding: finding ?? null }),
};
