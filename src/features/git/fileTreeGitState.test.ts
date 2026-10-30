import { describe, expect, it } from "vitest";
import type { GitFileStatus, GitStatusResult } from "../../store/types";
import { getGitState } from "./fileTreeGitState";

const entry = (path: string, status_type: GitFileStatus["status_type"]): GitFileStatus => ({ path, name: path.split("/").pop()!, status_type });
const status = (staged: GitFileStatus[], unstaged: GitFileStatus[]): GitStatusResult => ({ isRepo: true, currentBranch: "main", staged, unstaged });
const fileNode = (path: string) => ({ path, is_dir: false });
const dirNode = (path: string) => ({ path, is_dir: true });

describe("getGitState", () => {
  it("returns null without a status or when the entry is clean", () => {
    expect(getGitState(fileNode("/ws/a.ts"), null)).toBeNull();
    expect(getGitState(fileNode("/ws/a.ts"), status([], []))).toBeNull();
    expect(getGitState(dirNode("/ws/src"), status([], [entry("/ws/srcfile.ts", "modified")]))).toBeNull();
  });

  it("marks files by their staged/unstaged state", () => {
    expect(getGitState(fileNode("/ws/a.ts"), status([], [entry("/ws/a.ts", "untracked")]))).toMatchObject({ char: "U", label: "Untracked" });
    expect(getGitState(fileNode("/ws/a.ts"), status([], [entry("/ws/a.ts", "modified")]))).toMatchObject({ char: "M", label: "Modified" });
    expect(getGitState(fileNode("/ws/a.ts"), status([entry("/ws/a.ts", "added")], []))).toMatchObject({ char: "A", label: "Staged Added" });
    expect(getGitState(fileNode("/ws/a.ts"), status([entry("/ws/a.ts", "modified")], []))).toMatchObject({ char: "A", label: "Staged" });
    expect(getGitState(fileNode("/ws/a.ts"), status([entry("/ws/a.ts", "modified")], [entry("/ws/a.ts", "modified")]))).toMatchObject({
      char: "M",
      label: "Staged & Modified",
    });
  });

  it("summarizes folder contents", () => {
    const untracked = entry("/ws/src/new.ts", "untracked");
    const modified = entry("/ws/src/old.ts", "modified");
    expect(getGitState(dirNode("/ws/src"), status([], [untracked]))).toMatchObject({ char: "•", label: "Untracked contents" });
    expect(getGitState(dirNode("/ws/src"), status([], [untracked, modified]))).toMatchObject({ label: "Modified contents" });
    expect(getGitState(dirNode("/ws/src"), status([modified], []))).toMatchObject({ label: "Staged contents" });
    expect(getGitState(dirNode("/ws/src"), status([modified], [untracked]))).toMatchObject({ label: "Modified & Staged contents" });
  });

  it("uses warning color for modifications and success color for new files", () => {
    expect(getGitState(fileNode("/ws/a.ts"), status([], [entry("/ws/a.ts", "modified")]))!.colorClass).toContain("--color-status-warning");
    expect(getGitState(fileNode("/ws/a.ts"), status([], [entry("/ws/a.ts", "untracked")]))!.colorClass).toContain("--color-status-success");
  });
});
