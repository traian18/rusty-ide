/**
 * fileTreeGitState.ts
 *
 * Maps a file tree entry plus its repository's git status to the marker
 * (color class, letter, tooltip) the explorer draws next to it. Pure so the
 * rules are tested in one place (fileTreeGitState.test.ts).
 */

import type { GitStatusResult } from "../../store/types";
import type { FileEntry } from "./fileTreeModel";

export interface GitState {
  colorClass: string;
  char: string;
  label: string;
}

const WARNING = "text-[var(--color-status-warning)]";
const SUCCESS = "text-[var(--color-status-success)]";
const INFO = "text-[var(--color-status-info)]";

export function getGitState(node: Pick<FileEntry, "path" | "is_dir">, status: GitStatusResult | null | undefined): GitState | null {
  if (!status) return null;

  if (node.is_dir) {
    const inside = (file: { path: string }) => file.path.startsWith(`${node.path}/`);
    const hasUnstaged = status.unstaged.some(inside);
    const hasStaged = status.staged.some(inside);
    if (hasUnstaged && hasStaged) return { colorClass: WARNING, char: "•", label: "Modified & Staged contents" };
    if (hasUnstaged) {
      const untrackedOnly = !status.unstaged.some((file) => inside(file) && file.status_type !== "untracked");
      return untrackedOnly
        ? { colorClass: SUCCESS, char: "•", label: "Untracked contents" }
        : { colorClass: WARNING, char: "•", label: "Modified contents" };
    }
    if (hasStaged) return { colorClass: SUCCESS, char: "•", label: "Staged contents" };
    return null;
  }

  const staged = status.staged.find((file) => file.path === node.path);
  const unstaged = status.unstaged.find((file) => file.path === node.path);
  if (staged && unstaged) return { colorClass: `${WARNING} font-bold`, char: "M", label: "Staged & Modified" };
  if (unstaged) {
    return unstaged.status_type === "untracked"
      ? { colorClass: `${SUCCESS} opacity-90`, char: "U", label: "Untracked" }
      : { colorClass: `${WARNING} font-semibold`, char: "M", label: "Modified" };
  }
  if (staged) {
    return staged.status_type === "added"
      ? { colorClass: `${SUCCESS} font-bold`, char: "A", label: "Staged Added" }
      : { colorClass: `${INFO} font-bold`, char: "A", label: "Staged" };
  }
  return null;
}
