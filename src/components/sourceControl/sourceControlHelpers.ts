import type { GitFileStatus } from "../git/GitActions";
import type { GitStatusResult } from "../../store/types";

// ─────────────────────────────────────────────────────────────
// Status Indicator Helpers
// ─────────────────────────────────────────────────────────────

export interface StatusIndicator {
  char: string;
  colorClass: string;
}

/**
 * Returns the displayed character and Tailwind colour class for a given
 * Git file status type.  Used when rendering staged / unstaged file rows.
 */
export function getStatusIndicator(statusType: string): StatusIndicator {
  switch (statusType) {
    case "added":
      return {
        char: "A",
        colorClass: "text-[var(--color-status-success)] font-bold",
      };
    case "deleted":
      return {
        char: "D",
        colorClass: "text-[var(--color-status-danger)] font-bold",
      };
    case "untracked":
      return {
        char: "U",
        colorClass: "text-[var(--color-status-success)] opacity-80",
      };
    case "renamed":
      return {
        char: "R",
        colorClass: "text-[var(--color-status-info)] font-bold",
      };
    case "modified":
    default:
      return {
        char: "M",
        colorClass: "text-[var(--color-status-warning)] font-bold",
      };
  }
}

// ─────────────────────────────────────────────────────────────
// Unstaged List Builder
// ─────────────────────────────────────────────────────────────

/**
 * Builds the list of unstaged files, optionally collapsing a
 * delete + untracked pair into a single "renamed" entry when
 * `lastRename` is set.
 */
export function buildUnstagedList(
  gitStatus: GitStatusResult | null,
  lastRename: { originalPath: string; newPath: string } | null,
): GitFileStatus[] {
  if (!gitStatus) {
    return [];
  }

  if (!lastRename) {
    return gitStatus.unstaged;
  }

  const { originalPath, newPath } = lastRename;
  const hasDeleted = gitStatus.unstaged.some((f) => f.path === originalPath);
  const hasUntracked = gitStatus.unstaged.some((f) => f.path === newPath);

  if (!hasDeleted || !hasUntracked) {
    return gitStatus.unstaged;
  }

  const filtered = gitStatus.unstaged.filter(
    (f) => f.path !== originalPath && f.path !== newPath,
  );

  return [
    ...filtered,
    {
      path: newPath,
      name: `${originalPath.split("/").pop()} → ${newPath.split("/").pop()}`,
      status_type: "renamed" as const,
    },
  ];
}

// ─────────────────────────────────────────────────────────────
// Relative Directory Extractor
// ─────────────────────────────────────────────────────────────

/**
 * Extracts the relative directory path for a file underneath
 * the active repository root.
 */
export function getRelativeDirectory(
  repoPath: string,
  filePath: string,
  fileName: string,
): string {
  return filePath.substring(
    repoPath.length + 1,
    filePath.length - fileName.length - 1,
  );
}
