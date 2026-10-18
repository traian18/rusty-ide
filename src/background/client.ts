/** The host's background jobs: the list, progress and cancel, plus the documentation work queue. */
import { invoke } from "@tauri-apps/api/core";

export type JobKind = "analysis" | "documentation";
export type JobState = "running" | "finished" | "failed" | "cancelled";

export interface Job {
  id: number;
  kind: JobKind;
  root: string;
  label: string;
  detail: string | null;
  done: number | null;
  total: number | null;
  state: JobState;
  message: string | null;
}

export interface CommitPages {
  commit: string;
  files: string[];
  pages: { id: string; title: string }[];
}

export interface PendingDocumentation {
  pages: string[];
  model: string | null;
}

export interface BackgroundClient {
  jobs(): Promise<Job[]>;
  cancel(id: number): Promise<void>;
  start(root: string, label: string): Promise<number>;
  progress(id: number, done: number | null, total: number | null, detail: string | null): Promise<void>;
  finish(id: number, failed: boolean, message: string | null): Promise<void>;
  setBackground(enabled: boolean): Promise<void>;
  afterCommit(root: string): Promise<CommitPages>;
  pending(root: string): Promise<PendingDocumentation>;
  queue(root: string, pages: string[], model: string | null): Promise<void>;
  done(root: string, page: string): Promise<void>;
}

export const backgroundClient: BackgroundClient = {
  jobs: () => invoke<Job[]>("repository_jobs"),
  cancel: (id) => invoke<void>("repository_job_cancel", { id }),
  start: (root, label) => invoke<number>("repository_job_start", { root, label }),
  progress: (id, done, total, detail) => invoke<void>("repository_job_progress", { id, done, total, detail }),
  finish: (id, failed, message) => invoke<void>("repository_job_finish", { id, failed, message }),
  setBackground: (enabled) => invoke<void>("repository_set_background", { enabled }),
  afterCommit: (root) => invoke<CommitPages>("repository_documentation_after_commit", { root }),
  pending: (root) => invoke<PendingDocumentation>("repository_documentation_pending", { root }),
  queue: (root, pages, model) => invoke<void>("repository_documentation_queue", { root, pages, model }),
  done: (root, page) => invoke<void>("repository_documentation_done", { root, page }),
};
