import { describe, expect, it } from "vitest";
import { createGitClient, type Invoke } from "./client";
import { UnmergedBranchError } from "./gitErrors";
import { createGitService, type GitApp } from "./service";

/** A command bridge that records every call and answers from a table; an Error answer is thrown. */
function bridge(answers: Record<string, unknown> = {}) {
  const calls: [string, Record<string, unknown>][] = [];
  const invoke: Invoke = async (command, args) => {
    calls.push([command, args]);
    const answer = answers[command];
    if (answer instanceof Error) throw answer;
    return answer as never;
  };
  return { calls, client: createGitClient(invoke) };
}

/** The app side as a log: every effect is recorded in the order it happened. */
function app() {
  const log: string[] = [];
  const notifications: [string, string, string][] = [];
  const fake: GitApp = {
    loadStatus: async (rootDir) => { log.push(`loadStatus ${rootDir}`); },
    reloadTree: async (rootDir) => { log.push(`reloadTree ${rootDir}`); },
    resetForBranchChange: () => { log.push("resetForBranchChange"); },
    notify: (title, message, variant) => { notifications.push([title, message, variant]); },
    offerDocumentationUpdate: async (rootDir) => { log.push(`offerDocumentationUpdate ${rootDir}`); },
    openConflicts: (rootDir) => { log.push(`openConflicts ${rootDir}`); },
  };
  return { log, notifications, fake };
}

const confirmWith = (answer: boolean) => async () => answer;

const noConflicts = { operation: null, local_label: "main", incoming_label: "stashed changes", files: [] };
const conflictsIn = (operation: string | null, ...names: string[]) => ({
  operation,
  local_label: "main",
  incoming_label: "origin/main",
  files: names.map((name) => ({ path: `/repo/${name}`, relative_path: name, name, kind: "content" })),
});

describe("git service: changes", () => {
  it("stages a file and refreshes the status without touching the tree", async () => {
    const { calls, client } = bridge();
    const { log, fake } = app();

    await createGitService(client, fake).stageFile("/repo", "src/a.ts");

    expect(calls).toEqual([["git_stage_file", { rootDir: "/repo", filePath: "src/a.ts" }]]);
    expect(log).toEqual(["loadStatus /repo"]);
  });

  it("reports a failed stage and rethrows it", async () => {
    const { client } = bridge({ git_stage_file: new Error("index is locked") });
    const { notifications, fake } = app();

    await expect(createGitService(client, fake).stageFile("/repo", "a.ts")).rejects.toThrow("index is locked");
    expect(notifications).toEqual([["Stage Failed", "index is locked", "error"]]);
  });

  it("unstages a file and refreshes the status", async () => {
    const { calls, client } = bridge();
    const { log, fake } = app();

    await createGitService(client, fake).unstageFile("/repo", "a.ts");

    expect(calls[0][0]).toBe("git_unstage_file");
    expect(log).toEqual(["loadStatus /repo"]);
  });

  it("does nothing when the user declines to discard a file", async () => {
    const { calls, client } = bridge();
    const { log, notifications, fake } = app();

    await createGitService(client, fake).discardChanges("/repo", "a.ts", "a.ts", confirmWith(false));

    expect(calls).toEqual([]);
    expect(log).toEqual([]);
    expect(notifications).toEqual([]);
  });

  it("discards a confirmed file, then refreshes the status and tree in that order", async () => {
    const { calls, client } = bridge();
    const { log, notifications, fake } = app();

    await createGitService(client, fake).discardChanges("/repo", "src/a.ts", "a.ts", confirmWith(true));

    expect(calls).toEqual([["git_discard_changes", { rootDir: "/repo", filePath: "src/a.ts" }]]);
    expect(log).toEqual(["loadStatus /repo", "reloadTree /repo"]);
    expect(notifications).toEqual([["Discarded Changes", "Discarded changes for a.ts", "success"]]);
  });

  it("asks before discarding everything and runs the command only when confirmed", async () => {
    const asked: string[] = [];
    const { calls, client } = bridge();
    const { fake } = app();

    await createGitService(client, fake).discardAllChanges("/repo", async (title) => {
      asked.push(title);
      return true;
    });

    expect(asked).toEqual(["Discard All Changes"]);
    expect(calls).toEqual([["git_discard_all_changes", { rootDir: "/repo" }]]);
  });
});

describe("git service: refresh", () => {
  it("pulls, then refreshes the status and the tree before reporting success", async () => {
    const { calls, client } = bridge({ git_conflict_state: noConflicts });
    const { log, notifications, fake } = app();

    await createGitService(client, fake).pull("/repo");

    expect(calls[0]).toEqual(["git_pull", { rootDir: "/repo" }]);
    expect(log).toEqual(["loadStatus /repo", "reloadTree /repo"]);
    expect(notifications).toEqual([["Pull Complete", "Successfully pulled remote updates.", "success"]]);
  });
});

describe("git service: conflicts", () => {
  it("takes the user to the conflicts when a pull stops on them, without calling it a failure", async () => {
    const { client } = bridge({ git_pull: new Error("Automatic merge failed"), git_conflict_state: conflictsIn("merge", "a.ts", "b.ts") });
    const { log, notifications, fake } = app();

    await createGitService(client, fake).pull("/repo");

    expect(log).toEqual(["loadStatus /repo", "reloadTree /repo", "openConflicts /repo"]);
    expect(notifications).toEqual([["Merge Conflicts", "2 files need your decision before this can finish.", "danger"]]);
  });

  it("notices conflicts from putting stashed changes back after a pull that succeeded", async () => {
    const { client } = bridge({ git_conflict_state: conflictsIn(null, "a.ts") });
    const { log, notifications, fake } = app();

    await createGitService(client, fake).pull("/repo");

    expect(log).toContain("openConflicts /repo");
    expect(notifications.map(([title]) => title)).toEqual(["Merge Conflicts"]);
  });

  it("still reports a pull that failed for another reason", async () => {
    const { client } = bridge({ git_pull: new Error("no remote"), git_conflict_state: noConflicts });
    const { log, notifications, fake } = app();

    await expect(createGitService(client, fake).pull("/repo")).rejects.toThrow("no remote");

    expect(log).not.toContain("openConflicts /repo");
    expect(notifications).toEqual([["Pull Failed", "no remote", "error"]]);
  });

  it("takes the user to the conflicts of a merge or a rebase", async () => {
    const merge = bridge({ git_merge_branch: new Error("CONFLICT"), git_conflict_state: conflictsIn("merge", "a.ts") });
    const rebase = bridge({ git_rebase_branch: new Error("could not apply"), git_conflict_state: conflictsIn("rebase", "a.ts") });
    const { log, notifications, fake } = app();

    await createGitService(merge.client, fake).mergeBranch("/repo", "feature");
    await createGitService(rebase.client, fake).rebaseBranch("/repo", "main");

    expect(log.filter((entry) => entry === "openConflicts /repo")).toHaveLength(2);
    expect(notifications.map(([title]) => title)).toEqual(["Merge Conflicts", "Rebase Conflicts"]);
  });

  it("aborts the operation git says is in progress", async () => {
    const { calls, client } = bridge({ git_conflict_state: conflictsIn("cherry-pick", "a.ts") });
    const { notifications, fake } = app();

    await createGitService(client, fake).abortPending("/repo");

    expect(calls).toContainEqual(["git_abort_pending", { rootDir: "/repo", operation: "cherry-pick" }]);
    expect(notifications[0][0]).toBe("Cherry-pick Aborted");
  });

  it("has nothing to abort when no operation is in progress", async () => {
    const { calls, client } = bridge({ git_conflict_state: conflictsIn(null, "a.ts") });
    const { fake } = app();

    await createGitService(client, fake).abortPending("/repo");

    expect(calls.map(([command]) => command)).not.toContain("git_abort_pending");
  });

  it("reports a finished merge", async () => {
    const answers: Record<string, unknown> = { git_conflict_state: conflictsIn("merge") };
    const { client } = bridge(answers);
    const { log, notifications, fake } = app();

    await createGitService(client, fake).completePending("/repo");

    expect(log).toEqual(["loadStatus /repo", "reloadTree /repo"]);
    expect(notifications).toEqual([["Merge Complete", "All conflicts are resolved.", "success"]]);
  });

  it("stays on the conflicts when continuing a rebase stops at the next commit", async () => {
    const calls: string[] = [];
    let continued = false;
    const client = createGitClient(async (command) => {
      calls.push(command);
      if (command === "git_complete_pending") {
        continued = true;
        throw new Error("could not apply abc");
      }
      return (continued ? conflictsIn("rebase", "next.ts") : conflictsIn("rebase")) as never;
    });
    const { log, notifications, fake } = app();

    await createGitService(client, fake).completePending("/repo");

    expect(log).toContain("openConflicts /repo");
    expect(notifications.map(([title]) => title)).toEqual(["Rebase Conflicts"]);
  });

  it("reports a hook refusing the merge commit, leaving the merge in progress", async () => {
    const { client } = bridge({ git_complete_pending: new Error("pre-commit hook failed"), git_conflict_state: conflictsIn("merge") });
    const { notifications, fake } = app();

    await expect(createGitService(client, fake).completePending("/repo")).rejects.toThrow("pre-commit hook failed");

    expect(notifications).toEqual([["Merge Failed", "pre-commit hook failed", "error"]]);
  });
});

describe("git service: commit", () => {
  it("commits, refreshes the status, and offers a documentation update for the repository", async () => {
    const { calls, client } = bridge();
    const { log, notifications, fake } = app();

    await createGitService(client, fake).commit("/repo", "fix the tree");

    expect(calls).toEqual([["git_commit", { rootDir: "/repo", message: "fix the tree" }]]);
    expect(log).toEqual(["loadStatus /repo", "offerDocumentationUpdate /repo"]);
    expect(notifications).toEqual([["Commit Complete", "Successfully committed staged modifications.", "success"]]);
  });

  it("keeps a failed documentation offer from failing the commit", async () => {
    const { client } = bridge();
    const { fake } = app();
    fake.offerDocumentationUpdate = async () => { throw new Error("job queue busy"); };

    await expect(createGitService(client, fake).commit("/repo", "msg")).resolves.toBeUndefined();
  });
});

describe("git service: branch switch", () => {
  it("resets the workspace only after a successful checkout and says what was saved", async () => {
    const { calls, client } = bridge({ git_smart_checkout_branch: { stashed: true, restored: false } });
    const { log, notifications, fake } = app();

    await createGitService(client, fake).switchBranch("/repo", "origin/feature");

    expect(calls).toEqual([["git_smart_checkout_branch", { rootDir: "/repo", branchName: "origin/feature" }]]);
    expect(log).toEqual(["resetForBranchChange", "loadStatus /repo", "reloadTree /repo"]);
    expect(notifications).toEqual([[
      "Branch Switched",
      "Active branch is now: feature. Current branch changes were saved.",
      "success",
    ]]);
  });

  it("leaves the current view alone when the checkout fails", async () => {
    const { client } = bridge({ git_smart_checkout_branch: new Error("local changes would be overwritten") });
    const { log, notifications, fake } = app();

    await expect(createGitService(client, fake).switchBranch("/repo", "main")).rejects.toThrow();
    expect(log).toEqual([]);
    expect(notifications).toEqual([["Checkout Failed", "local changes would be overwritten", "error"]]);
  });
});

describe("git service: branch deletion", () => {
  it("turns an unmerged refusal into UnmergedBranchError without a notification", async () => {
    const { client } = bridge({ git_delete_branch: new Error("error: the branch 'feature' is not fully merged.") });
    const { notifications, fake } = app();

    await expect(createGitService(client, fake).deleteBranch("/repo", "feature", false))
      .rejects.toBeInstanceOf(UnmergedBranchError);
    expect(notifications).toEqual([]);
  });

  it("forces a deletion the user confirmed, and refreshes the status", async () => {
    const { calls, client } = bridge();
    const { log, fake } = app();

    await createGitService(client, fake).deleteBranch("/repo", "feature", true);

    expect(calls).toEqual([["git_delete_branch", { rootDir: "/repo", branchName: "feature", force: true }]]);
    expect(log).toEqual(["loadStatus /repo"]);
  });
});
