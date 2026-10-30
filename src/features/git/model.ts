/** Git types shared by the feature's logic, views and client. */
export type { GitFileStatus, GitStatusResult, GitRepository, GitHeadState, SubmoduleState, GitError } from "../../store/types";

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

/** A merge or rebase that was started and then has to be finished or aborted. */
export type PendingOperation = "merge" | "rebase";
