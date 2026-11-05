/** Git types shared by the feature's logic, views and client. */
import type { GitFileStatus } from "../../store/types";

export type { GitFileStatus, GitRepository, GitHeadState, SubmoduleState, GitError } from "../../store/types";

/** One commit as the history commands return it. */
export interface CommitInfo {
  hash: string;
  short_hash: string;
  parents: string[];
  author: string;
  date: string;
  subject: string;
  decorations: string;
  is_unpushed: boolean;
}

/** One file a commit changed. */
export interface CommitFile {
  path: string;
  name: string;
  status_type: string;
}

/** The local and remote branch names of a repository. */
export interface Branches {
  local: string[];
  remote: string[];
}

/** One line of a file's blame. */
export interface BlameLine {
  line_number: number;
  author: string;
  date: string;
}

/** What a smart checkout did with the current branch's changes. */
export interface CheckoutOutcome {
  stashed: boolean;
  restored: boolean;
}

/** An operation that stopped part way and has to be finished or aborted. */
export type PendingOperation = "merge" | "rebase" | "cherry-pick" | "revert";

export interface GitStatusResult {
  isRepo: boolean;
  currentBranch: string;
  staged: GitFileStatus[];
  unstaged: GitFileStatus[];
  /** Files git could not merge; they are in neither list above. */
  conflicted: GitFileStatus[];
  /** The operation in progress, if any. */
  pendingOperation: PendingOperation | null;
}

/** Which sides still have a conflicted file. */
export type ConflictKind = "content" | "local-only" | "incoming-only" | "both-deleted";

/** The side of a conflict: the user's own work, or what is being brought in. */
export type ConflictSide = "local" | "incoming";

/** One path git could not merge. */
export interface ConflictEntry {
  path: string;
  relativePath: string;
  name: string;
  kind: ConflictKind;
}

/** The operation in progress and what it could not merge. No operation means a stash stopped on conflicts. */
export interface ConflictState {
  operation: PendingOperation | null;
  localLabel: string;
  incomingLabel: string;
  files: ConflictEntry[];
}

/** One side's change against the other version, as 0-based half-open line ranges. */
export interface LineHunk {
  baseStart: number;
  baseEnd: number;
  sideStart: number;
  sideEnd: number;
}

/** A conflicted file's versions. `binary` covers files too large to show, and leaves the versions empty. */
export interface ConflictFile {
  path: string;
  relativePath: string;
  kind: ConflictKind;
  binary: boolean;
  base: string | null;
  local: string | null;
  incoming: string | null;
  working: string | null;
  localHunks: LineHunk[];
  incomingHunks: LineHunk[];
}
