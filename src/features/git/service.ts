/** Git actions for the workspace. Each one runs a git command, then brings the app up to date and tells the user what happened. */
import type { NotificationVariant } from "../notifications";
import type { GitClient } from "./client";
import type { ConflictSide, ConflictState, PendingOperation } from "./model";
import { gitErrorMessage as errorMessage, isUnmergedBranchError, UnmergedBranchError } from "./gitErrors";

/** What the actions need from the app: the store, the file tree, notifications and the documentation update. */
export interface GitApp {
  loadStatus(rootDir: string): Promise<void>;
  /** Reloads the file tree from the workspace root, so it shows the changes an action made on disk. */
  reloadTree(rootDir: string): Promise<void>;
  /** Unmounts branch-specific editors and clears the tree before a branch switch shows the new one. */
  resetForBranchChange(): void;
  notify(title: string, message: string, variant: NotificationVariant): void;
  offerDocumentationUpdate(rootDir: string): Promise<unknown>;
  /** Opens the merge window on a repository's conflicts. */
  openConflicts(rootDir: string): void;
}

export type Confirm = (title: string, message: string) => Promise<boolean>;

export interface GitService {
  commit(rootDir: string, message: string): Promise<void>;
  push(rootDir: string, branchName: string): Promise<void>;
  pull(rootDir: string): Promise<void>;
  stageFile(rootDir: string, filePath: string): Promise<void>;
  unstageFile(rootDir: string, filePath: string): Promise<void>;
  addToGitignore(rootDir: string, filePath: string): Promise<void>;
  discardChanges(rootDir: string, filePath: string, fileName: string, confirmFn: Confirm): Promise<void>;
  discardAllChanges(rootDir: string, confirmFn: Confirm): Promise<void>;
  switchBranch(rootDir: string, branchName: string): Promise<void>;
  createBranch(rootDir: string, branchName: string, checkout: boolean): Promise<void>;
  deleteBranch(rootDir: string, branchName: string, force: boolean): Promise<void>;
  mergeBranch(rootDir: string, branchName: string): Promise<void>;
  rebaseBranch(rootDir: string, branchName: string): Promise<void>;
  abortPending(rootDir: string): Promise<void>;
  resolveConflict(rootDir: string, filePath: string, content: string): Promise<void>;
  resolveConflictSide(rootDir: string, filePath: string, side: ConflictSide): Promise<void>;
  completePending(rootDir: string): Promise<void>;
  undoLastRename(rootDir: string, originalPath: string, newPath: string): Promise<void>;
}

/** The operation's name in a sentence. */
function operationLabel(operation: PendingOperation | null): string {
  if (operation === "rebase") return "Rebase";
  if (operation === "cherry-pick") return "Cherry-pick";
  if (operation === "revert") return "Revert";
  return "Merge";
}

export function createGitService(git: GitClient, app: GitApp): GitService {
  /**
   * After a command stopped or finished, checks git rather than its error text
   * for conflicts, and takes the user to them. True when there are any.
   */
  const openConflictsIfAny = async (rootDir: string, state?: ConflictState): Promise<boolean> => {
    const conflicts = state ?? await git.conflictState(rootDir).catch(() => null);
    if (!conflicts || conflicts.files.length === 0) return false;
    await app.loadStatus(rootDir);
    await app.reloadTree(rootDir);
    const count = conflicts.files.length;
    const files = count === 1 ? "1 file needs" : `${count} files need`;
    app.notify(`${operationLabel(conflicts.operation)} Conflicts`, `${files} your decision before this can finish.`, "danger");
    app.openConflicts(rootDir);
    return true;
  };

  return {
    async commit(rootDir, message) {
      console.log(`GitService: Committing staged changes at ${rootDir} with message: "${message}"`);
      try {
        await git.commit(rootDir, message);
        await app.loadStatus(rootDir);
        app.notify("Commit Complete", "Successfully committed staged modifications.", "success");
        // Pages written from what this commit changed can be brought up to date in the background.
        void app.offerDocumentationUpdate(rootDir).catch(() => undefined);
      } catch (err: any) {
        console.error("Failed to commit git modifications:", err);
        app.notify("Commit Failed", errorMessage(err), "error");
        throw err;
      }
    },

    async push(rootDir, branchName) {
      console.log(`GitService: Pushing branch ${branchName} at ${rootDir}`);
      try {
        await git.push(rootDir, branchName);
        app.notify("Push Complete", "Successfully pushed local commits to remote.", "success");
      } catch (err: any) {
        console.error("Failed to push branch:", err);
        app.notify("Push Failed", errorMessage(err), "error");
        throw err;
      }
    },

    async pull(rootDir) {
      console.log(`GitService: Pulling changes at ${rootDir}`);
      try {
        await git.pull(rootDir);
        // A pull can succeed and still leave conflicts: putting back stashed changes stops on them.
        if (await openConflictsIfAny(rootDir)) return;
        await app.loadStatus(rootDir);
        await app.reloadTree(rootDir);
        app.notify("Pull Complete", "Successfully pulled remote updates.", "success");
      } catch (err: any) {
        if (await openConflictsIfAny(rootDir)) return;
        console.error("Failed to pull changes:", err);
        app.notify("Pull Failed", errorMessage(err), "error");
        throw err;
      }
    },

    async stageFile(rootDir, filePath) {
      console.log(`GitService: Staging file ${filePath}`);
      try {
        await git.stageFile(rootDir, filePath);
        await app.loadStatus(rootDir);
      } catch (err: any) {
        console.error(`Failed to stage file:`, err);
        app.notify("Stage Failed", errorMessage(err), "error");
        throw err;
      }
    },

    async unstageFile(rootDir, filePath) {
      console.log(`GitService: Unstaging file ${filePath}`);
      try {
        await git.unstageFile(rootDir, filePath);
        await app.loadStatus(rootDir);
      } catch (err: any) {
        console.error(`Failed to unstage file:`, err);
        app.notify("Unstage Failed", errorMessage(err), "error");
        throw err;
      }
    },

    async addToGitignore(rootDir, filePath) {
      console.log(`GitService: Adding to .gitignore: ${filePath}`);
      try {
        await git.addToGitignore(rootDir, filePath);
        await app.loadStatus(rootDir);
        await app.reloadTree(rootDir);
        app.notify("Added to .gitignore", "File will no longer show up as a change.", "success");
      } catch (err: any) {
        console.error("Failed to add to .gitignore:", err);
        app.notify("Failed", errorMessage(err), "error");
        throw err;
      }
    },

    async discardChanges(rootDir, filePath, fileName, confirmFn) {
      console.log(`GitService: Request to discard changes in ${filePath}`);
      const confirmed = await confirmFn(
        "Discard Changes",
        `Are you sure you want to discard all unstaged changes in "${fileName}"? This cannot be undone.`,
      );
      if (!confirmed) return;
      try {
        await git.discardChanges(rootDir, filePath);
        await app.loadStatus(rootDir);
        await app.reloadTree(rootDir);
        app.notify("Discarded Changes", `Discarded changes for ${fileName}`, "success");
      } catch (err: any) {
        console.error(`Failed to discard changes:`, err);
        app.notify("Discard Failed", errorMessage(err), "error");
        throw err;
      }
    },

    async discardAllChanges(rootDir, confirmFn) {
      console.log(`GitService: Request to discard ALL changes in ${rootDir}`);
      const confirmed = await confirmFn(
        "Discard All Changes",
        "Are you sure you want to discard ALL unstaged modifications and untracked files? This action CANNOT BE UNDONE.",
      );
      if (!confirmed) return;
      try {
        await git.discardAllChanges(rootDir);
        await app.loadStatus(rootDir);
        await app.reloadTree(rootDir);
        app.notify("Discard complete", "All unstaged changes have been discarded.", "success");
      } catch (err: any) {
        console.error("Failed to discard all changes:", err);
        app.notify("Discard Failed", errorMessage(err), "error");
        throw err;
      }
    },

    async switchBranch(rootDir, branchName) {
      console.log(`GitService: Checking out branch ${branchName}`);
      try {
        const result = await git.smartCheckoutBranch(rootDir, branchName);
        // Clear the old tree only after the checkout succeeds, so a failed checkout leaves the current view intact.
        app.resetForBranchChange();
        await app.loadStatus(rootDir);
        await app.reloadTree(rootDir);
        const display = branchName.startsWith("origin/") ? branchName.substring(7) : branchName;
        const preserved = result.stashed ? " Current branch changes were saved." : "";
        const restored = result.restored ? " Saved branch changes were restored." : "";
        app.notify("Branch Switched", `Active branch is now: ${display}.${preserved}${restored}`, "success");
      } catch (err: any) {
        console.error("Failed to switch branch:", err);
        app.notify("Checkout Failed", errorMessage(err), "error");
        throw err;
      }
    },

    async createBranch(rootDir, branchName, checkout) {
      console.log(`GitService: Creating branch ${branchName} (checkout: ${checkout})`);
      try {
        await git.createBranch(rootDir, branchName, checkout);
        if (checkout) {
          // A new branch starts at HEAD, so changes carry over untouched and nothing on disk changes.
          await app.loadStatus(rootDir);
        }
        app.notify(
          "Branch Created",
          checkout
            ? `Switched to new branch ${branchName}. Uncommitted changes came with you.`
            : `Created branch ${branchName}.`,
          "success",
        );
      } catch (err: any) {
        console.error("Failed to create branch:", err);
        app.notify("Creation Failed", errorMessage(err), "error");
        throw err;
      }
    },

    async deleteBranch(rootDir, branchName, force) {
      console.log(`GitService: Deleting branch ${branchName} (force: ${force})`);
      try {
        if (branchName.startsWith("origin/")) {
          await git.deleteRemoteBranch(rootDir, branchName);
        } else {
          await git.deleteBranch(rootDir, branchName, force);
        }
        await app.loadStatus(rootDir);
        app.notify("Branch Deleted", `Successfully deleted branch: ${branchName}`, "success");
      } catch (err: any) {
        if (!force && isUnmergedBranchError(err)) {
          // Not a failure to report yet: the caller asks whether to force it.
          throw new UnmergedBranchError(errorMessage(err));
        }
        console.error("Failed to delete branch:", err);
        app.notify("Deletion Failed", errorMessage(err), "error");
        throw err;
      }
    },

    async mergeBranch(rootDir, branchName) {
      console.log(`GitService: Merging branch ${branchName} into current`);
      try {
        const result = await git.mergeBranch(rootDir, branchName);
        await app.loadStatus(rootDir);
        await app.reloadTree(rootDir);
        app.notify("Merge Complete", String(result) || `Merged ${branchName} into current.`, "success");
      } catch (err: any) {
        if (await openConflictsIfAny(rootDir)) return;
        app.notify("Merge Failed", errorMessage(err), "error");
        throw err;
      }
    },

    async rebaseBranch(rootDir, branchName) {
      console.log(`GitService: Rebasing current branch onto ${branchName}`);
      try {
        const result = await git.rebaseBranch(rootDir, branchName);
        await app.loadStatus(rootDir);
        await app.reloadTree(rootDir);
        app.notify("Rebase Complete", String(result) || `Rebased onto ${branchName}.`, "success");
      } catch (err: any) {
        if (await openConflictsIfAny(rootDir)) return;
        app.notify("Rebase Failed", errorMessage(err), "error");
        throw err;
      }
    },

    async abortPending(rootDir) {
      console.log(`GitService: Aborting pending merge/rebase`);
      try {
        const { operation } = await git.conflictState(rootDir);
        if (!operation) {
          app.notify("Nothing to Abort", "No merge or rebase is in progress.", "info");
          return;
        }
        await git.abortPending(rootDir, operation);
        await app.loadStatus(rootDir);
        await app.reloadTree(rootDir);
        app.notify(`${operationLabel(operation)} Aborted`, "The repository is back to how it was before.", "success");
      } catch (err: any) {
        app.notify("Abort Failed", errorMessage(err), "error");
        throw err;
      }
    },

    async resolveConflict(rootDir, filePath, content) {
      try {
        await git.resolveConflict(rootDir, filePath, content);
        await app.loadStatus(rootDir);
      } catch (err: any) {
        app.notify("Resolve Failed", errorMessage(err), "error");
        throw err;
      }
    },

    async resolveConflictSide(rootDir, filePath, side) {
      try {
        await git.resolveConflictSide(rootDir, filePath, side);
        await app.loadStatus(rootDir);
        await app.reloadTree(rootDir);
      } catch (err: any) {
        app.notify("Resolve Failed", errorMessage(err), "error");
        throw err;
      }
    },

    async completePending(rootDir) {
      const { operation } = await git.conflictState(rootDir);
      const label = operationLabel(operation);
      try {
        await git.completePending(rootDir);
        // A rebase stops again at the next commit that conflicts.
        if (await openConflictsIfAny(rootDir)) return;
        await app.loadStatus(rootDir);
        await app.reloadTree(rootDir);
        app.notify(`${label} Complete`, "All conflicts are resolved.", "success");
      } catch (err: any) {
        if (await openConflictsIfAny(rootDir)) return;
        await app.loadStatus(rootDir);
        app.notify(`${label} Failed`, errorMessage(err), "error");
        throw err;
      }
    },

    async undoLastRename(rootDir, originalPath, newPath) {
      console.log(`GitService: Undoing last move/rename: ${newPath} -> ${originalPath}`);
      try {
        await git.undoLastRename(rootDir, originalPath, newPath);
        await app.loadStatus(rootDir);
        await app.reloadTree(rootDir);
        app.notify("Undo Complete", "Move/rename has been undone.", "success");
      } catch (err: any) {
        app.notify("Undo Failed", errorMessage(err), "error");
        throw err;
      }
    },
  };
}
