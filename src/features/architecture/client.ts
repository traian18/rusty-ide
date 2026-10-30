/**
 * The only module that talks to Tauri. Everything else receives an [`ArchitectureClient`], so
 * components and hooks are tested with a plain fake and never touch the native bridge.
 */
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type {
  FindingBadges, FindingExplanation, FindingsPage, Freshness, GitFileFacts, GroupAssignment, GroupGraph,
  ImportKind, ImportPage, LevelName, LevelView, NodesExist, OpenResponse, RefreshResponse,
  RepositoryError, Severity, Confidence, FindingKind, FrameworkPage, RelationKind,
} from "./model";

export interface FindingsRequest {
  rules?: string[];
  kind?: FindingKind;
  min_severity?: Severity;
  min_confidence?: Confidence;
  package?: string;
  file?: string;
  include_suppressed?: boolean;
  cursor?: unknown;
  limit?: number;
}

export interface ArchitectureClient {
  open(root: string): Promise<OpenResponse>;
  refresh(root: string, includeGit: boolean): Promise<RefreshResponse>;
  cancel(root: string): Promise<void>;
  close(root: string): Promise<void>;
  architecture(root: string, request: { level: LevelName; focus?: string | null; import_kind?: ImportKind; node_limit?: number; edge_limit?: number }): Promise<LevelView>;
  frameworkRelations(root: string, request: { framework?: string; kind?: RelationKind; file?: string; package?: string; cursor?: unknown; limit?: number }): Promise<FrameworkPage>;
  groupGraph(root: string, request: { group: string; node_limit?: number; edge_limit?: number }): Promise<GroupGraph>;
  edges(root: string, request: { file: string; direction: "imports" | "importers"; cursor?: unknown; limit?: number }): Promise<ImportPage>;
  groupsOf(root: string, file: string): Promise<GroupAssignment[]>;
  findings(root: string, request: FindingsRequest): Promise<FindingsPage>;
  findingExplain(root: string, finding: string): Promise<FindingExplanation>;
  findingBadges(root: string): Promise<FindingBadges>;
  gitFile(root: string, file: string): Promise<GitFileFacts | null>;
  freshness(root: string): Promise<Freshness>;
  nodesExist(root: string, request: { groups: string[]; files: string[] }): Promise<NodesExist>;
  loadState(root: string): Promise<unknown | null>;
  saveState(root: string, document: unknown): Promise<void>;
  /** Calls `callback` whenever files in the workspace change; returns the unsubscribe function. */
  onWorkspaceChanged(callback: () => void): Promise<() => void>;
  /** A background analysis finished and replaced a repository's saved analysis (its root). */
  onAnalysisUpdated(callback: (root: string) => void): Promise<() => void>;
}

/** Normalises whatever a rejected command carries into a [`RepositoryError`]. */
export function toRepositoryError(error: unknown): RepositoryError {
  if (error && typeof error === "object" && "code" in error && "message" in error) {
    const { code, message } = error as { code: unknown; message: unknown };
    if (typeof code === "string" && typeof message === "string") return { code, message };
  }
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : "Unexpected error";
  return { code: "unexpected", message };
}

async function call<T>(command: string, args: Record<string, unknown>): Promise<T> {
  try {
    return await invoke<T>(command, args);
  } catch (error) {
    throw toRepositoryError(error);
  }
}

export const tauriClient: ArchitectureClient = {
  open: (root) => call("repository_open", { root }),
  refresh: (root, includeGit) => call("repository_refresh", { root, includeGit }),
  cancel: (root) => call("repository_cancel", { root }),
  close: (root) => call("repository_close", { root }),
  architecture: (root, request) => call("repository_architecture", { root, request }),
  frameworkRelations: (root, request) => call("repository_framework_relations", { root, request }),
  groupGraph: (root, request) => call("repository_group_graph", { root, request }),
  edges: (root, request) => call("repository_edges", { root, request }),
  groupsOf: (root, file) => call("repository_groups_of", { root, file }),
  findings: (root, request) => call("repository_findings", { root, request }),
  findingExplain: (root, finding) => call("repository_finding_explain", { root, finding }),
  findingBadges: (root) => call("repository_finding_badges", { root }),
  gitFile: (root, file) => call("repository_git_file", { root, file }),
  freshness: (root) => call("repository_freshness", { root }),
  nodesExist: (root, request) => call("repository_nodes_exist", { root, request }),
  loadState: (root) => call("repository_state_load", { root }),
  saveState: (root, document) => call("repository_state_save", { root, document }),
  onWorkspaceChanged: async (callback) => listen("workspace-fs-changed", () => callback()),
  onAnalysisUpdated: async (callback) => listen<string>("repository-analysis-updated", (event) => callback(event.payload)),
};
