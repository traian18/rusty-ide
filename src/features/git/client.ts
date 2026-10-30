/** Every git command the IDE calls, one method per Tauri command. Nothing else in the feature calls git directly. */
import { invoke } from "@tauri-apps/api/core";
import type { BlameLine, Branches, CheckoutOutcome, CommitFile, CommitInfo, PendingOperation } from "./model";

/** Calls a Tauri command by name. The app passes the real bridge; tests pass a fake one. */
export type Invoke = <T>(command: string, args: Record<string, unknown>) => Promise<T>;

export interface GitClient {
  /** The wire form of a repository's status; `mapGitStatusResult` in state.ts reads it. */
  status(rootDir: string): Promise<unknown>;
  /** The wire form of each repository found under the workspace root. */
  discoverWorkspaceRepositories(rootDir: string): Promise<unknown[]>;
  /** The wire form of one repository's HEAD, wrapped as `{ head }`. */
  discoverRepository(rootDir: string): Promise<{ head: unknown }>;
  init(rootDir: string): Promise<void>;
  fetch(rootDir: string): Promise<void>;

  initSubmodule(rootDir: string, submodulePath: string): Promise<void>;
  updateSubmodule(rootDir: string, submodulePath: string, recursive: boolean): Promise<void>;
  syncSubmodule(rootDir: string, submodulePath: string): Promise<void>;

  commit(rootDir: string, message: string): Promise<void>;
  push(rootDir: string, branchName: string): Promise<void>;
  pull(rootDir: string): Promise<void>;
  stageFile(rootDir: string, filePath: string): Promise<void>;
  unstageFile(rootDir: string, filePath: string): Promise<void>;
  addToGitignore(rootDir: string, filePath: string): Promise<void>;
  discardChanges(rootDir: string, filePath: string): Promise<void>;
  discardAllChanges(rootDir: string): Promise<void>;
  undoLastRename(rootDir: string, originalPath: string, newPath: string): Promise<void>;

  branches(rootDir: string): Promise<Branches>;
  smartCheckoutBranch(rootDir: string, branchName: string): Promise<CheckoutOutcome>;
  createBranch(rootDir: string, branchName: string, checkout: boolean): Promise<void>;
  deleteBranch(rootDir: string, branchName: string, force: boolean): Promise<void>;
  deleteRemoteBranch(rootDir: string, branchName: string): Promise<void>;
  /** The command's message, shown to the user after a merge completes. */
  mergeBranch(rootDir: string, branchName: string): Promise<string>;
  /** The command's message, shown to the user after a rebase completes. */
  rebaseBranch(rootDir: string, branchName: string): Promise<string>;
  abortPending(rootDir: string, operation: PendingOperation): Promise<void>;

  commitHistory(rootDir: string): Promise<CommitInfo[]>;
  fileCommitHistory(rootDir: string, filePath: string): Promise<CommitInfo[]>;
  commitFiles(rootDir: string, commitHash: string): Promise<CommitFile[]>;
  revertCommit(rootDir: string, commitHash: string): Promise<void>;
  resetToCommit(rootDir: string, commitHash: string): Promise<void>;

  blame(rootDir: string, filePath: string): Promise<BlameLine[]>;
  headContent(rootDir: string, filePath: string): Promise<string>;
  indexContent(rootDir: string, filePath: string): Promise<string>;
  fileContentAtRevision(rootDir: string, filePath: string, revision: string): Promise<string>;
  /** The working-tree side of a diff. It is not a git command, but diff loading reads it alongside git content. */
  readWorkingFile(path: string): Promise<string>;
}

/** Builds the git client on a command bridge. Each method names exactly one Tauri command and its arguments. */
export function createGitClient(call: Invoke): GitClient {
  return {
    status: (rootDir) => call("git_status", { rootDir }),
    discoverWorkspaceRepositories: (rootDir) => call("git_discover_workspace_repositories", { rootDir }),
    discoverRepository: (rootDir) => call("git_discover_repository", { rootDir }),
    init: (rootDir) => call("git_init", { rootDir }),
    fetch: (rootDir) => call("git_fetch", { rootDir }),

    initSubmodule: (rootDir, submodulePath) => call("git_submodule_init", { rootDir, submodulePath }),
    updateSubmodule: (rootDir, submodulePath, recursive) => call("git_submodule_update", { rootDir, submodulePath, recursive }),
    syncSubmodule: (rootDir, submodulePath) => call("git_submodule_sync", { rootDir, submodulePath }),

    commit: (rootDir, message) => call("git_commit", { rootDir, message }),
    push: (rootDir, branchName) => call("git_push", { rootDir, branchName }),
    pull: (rootDir) => call("git_pull", { rootDir }),
    stageFile: (rootDir, filePath) => call("git_stage_file", { rootDir, filePath }),
    unstageFile: (rootDir, filePath) => call("git_unstage_file", { rootDir, filePath }),
    addToGitignore: (rootDir, filePath) => call("git_add_to_gitignore", { rootDir, filePath }),
    discardChanges: (rootDir, filePath) => call("git_discard_changes", { rootDir, filePath }),
    discardAllChanges: (rootDir) => call("git_discard_all_changes", { rootDir }),
    undoLastRename: (rootDir, originalPath, newPath) => call("git_undo_last_rename", { rootDir, originalPath, newPath }),

    branches: (rootDir) => call("git_get_all_branches", { rootDir }),
    smartCheckoutBranch: (rootDir, branchName) => call("git_smart_checkout_branch", { rootDir, branchName }),
    createBranch: (rootDir, branchName, checkout) => call("git_create_branch", { rootDir, branchName, checkout }),
    deleteBranch: (rootDir, branchName, force) => call("git_delete_branch", { rootDir, branchName, force }),
    deleteRemoteBranch: (rootDir, branchName) => call("git_delete_remote_branch", { rootDir, branchName }),
    mergeBranch: (rootDir, branchName) => call("git_merge_branch", { rootDir, branchName }),
    rebaseBranch: (rootDir, branchName) => call("git_rebase_branch", { rootDir, branchName }),
    abortPending: (rootDir, operation) => call("git_abort_pending", { rootDir, operation }),

    commitHistory: (rootDir) => call("git_get_commit_history", { rootDir }),
    fileCommitHistory: (rootDir, filePath) => call("git_get_file_commit_history", { rootDir, filePath }),
    commitFiles: (rootDir, commitHash) => call("git_get_commit_files", { rootDir, commitHash }),
    revertCommit: (rootDir, commitHash) => call("git_revert_commit", { rootDir, commitHash }),
    resetToCommit: (rootDir, commitHash) => call("git_reset_to_commit", { rootDir, commitHash }),

    blame: (rootDir, filePath) => call("git_blame", { rootDir, filePath }),
    headContent: (rootDir, filePath) => call("git_get_head_content", { rootDir, filePath }),
    indexContent: (rootDir, filePath) => call("git_get_index_content", { rootDir, filePath }),
    fileContentAtRevision: (rootDir, filePath, revision) => call("git_get_file_content_at_rev", { rootDir, filePath, revision }),
    readWorkingFile: (path) => call("read_file_disk", { path }),
  };
}

/** The app's git client, backed by the Tauri bridge. */
export const gitClient: GitClient = createGitClient(invoke);
