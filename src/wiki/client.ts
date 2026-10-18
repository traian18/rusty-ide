/** The documentation's window to Tauri: the architecture client (open, refresh, freshness), the workspace overview and the written-documentation commands. */
import { invoke } from "@tauri-apps/api/core";

import { tauriClient, type ArchitectureClient } from "../architecture/client";
import type { BriefView, DocumentationPlan, DocumentationSettings, WrittenView } from "./written";

/** One repository of the workspace folder, with whether an index is loaded for it. */
export interface WorkspaceRepository {
  id: string;
  name: string;
  /** Relative to the workspace folder; `.` when the repository is the folder itself. */
  path: string;
  kind: string;
  branch: string | null;
  indexed: boolean;
  built_at_ms: number | null;
  files: number;
}

export interface DocsClient extends ArchitectureClient {
  workspaceRepositories(root: string): Promise<WorkspaceRepository[]>;
  documentationPlan(root: string): Promise<DocumentationPlan>;
  documentationBrief(root: string, id: string): Promise<BriefView>;
  documentationSave(root: string, id: string, markdown: string, model: string): Promise<WrittenView>;
  documentationPage(root: string, id: string): Promise<WrittenView | null>;
  documentationSettings(root: string): Promise<DocumentationSettings>;
  setDocumentationSettings(root: string, settings: DocumentationSettings): Promise<void>;
}

export const docsClient: DocsClient = {
  ...tauriClient,
  workspaceRepositories: (root) => invoke<WorkspaceRepository[]>("repository_workspace_overview", { root }),
  documentationPlan: (root) => invoke<DocumentationPlan>("repository_documentation_plan", { root }),
  documentationBrief: (root, id) => invoke<BriefView>("repository_documentation_brief", { root, id }),
  documentationSave: (root, id, markdown, model) => invoke<WrittenView>("repository_documentation_save", { root, id, markdown, model }),
  documentationPage: (root, id) => invoke<WrittenView | null>("repository_documentation_page", { root, id }),
  documentationSettings: (root) => invoke<DocumentationSettings>("repository_documentation_settings", { root }),
  setDocumentationSettings: (root, settings) => invoke<void>("repository_documentation_set_settings", { root, settings }),
};
