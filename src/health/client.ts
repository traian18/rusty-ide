/** The Code Health page's commands. */
import { invoke } from "@tauri-apps/api/core";

import type { HealthFileDetail, HealthReport } from "./model";

export interface HealthClient {
  report(root: string): Promise<HealthReport>;
  file(root: string, path: string): Promise<HealthFileDetail>;
  /** "Copy fix prompt" text for a file, or one finding in it. */
  prompt(root: string, path: string, finding?: string): Promise<string>;
}

export const healthClient: HealthClient = {
  report: (root) => invoke<HealthReport>("repository_code_health", { root }),
  file: (root, path) => invoke<HealthFileDetail>("repository_code_health_file", { root, path }),
  prompt: (root, path, finding) => invoke<string>("repository_code_health_prompt", { root, path, finding: finding ?? null }),
};
