/**
 * workflowRunStore — how each workflow's latest run is going, shared between
 * the Agent tab (which runs it) and the Behaviors canvas (which shows each
 * step's status on its node), plus one-shot hand-offs between the two tabs.
 * Which workflow a chat follows belongs to that chat (saved in its file),
 * not to this store.
 *
 * Deliberately a small standalone store, like notificationStore: nothing
 * here needs persisting or belongs to the workspace store's slices.
 */

import { create } from "zustand";
import type { WorkflowStepProgress } from "../../../harness/core/workflowRun";

export type WorkflowRunStatus = "running" | "completed" | "failed" | "cancelled";

export interface WorkflowRunView {
  status: WorkflowRunStatus;
  steps: Record<string, WorkflowStepProgress>;
  /** The step the run is on: the one that last started, retried or waits. */
  current?: string;
  startedAt: number;
  /** When the run last showed a sign of life (a step change, output, a tool). Drives the "no activity" notice. */
  lastActivityAt: number;
  error?: string;
}

interface WorkflowRunStore {
  /** "Run in Agent Mode": a workflow path for the Agent tab to adopt. */
  agentRequest?: string;
  /** "Edit" from Agent Mode: a workflow path for the Behaviors tab to open. */
  behaviorsRequest?: string;
  /** Bumped when workflow files change, so pickers reload their list. */
  catalogVersion: number;
  /** Latest run per workflow id. */
  runs: Record<string, WorkflowRunView>;
  requestAgentWorkflow(path: string): void;
  takeAgentRequest(): string | undefined;
  requestBehaviorsWorkflow(path: string): void;
  takeBehaviorsRequest(): string | undefined;
  catalogChanged(): void;
  begin(workflowId: string): void;
  /** Record activity on every run that is still going. */
  touchRunning(): void;
  step(workflowId: string, progress: WorkflowStepProgress): void;
  finish(workflowId: string, status: Exclude<WorkflowRunStatus, "running">, error?: string): void;
}

export const useWorkflowRunStore = create<WorkflowRunStore>((set, get) => ({
  agentRequest: undefined,
  behaviorsRequest: undefined,
  catalogVersion: 0,
  runs: {},
  requestAgentWorkflow: (path) => set({ agentRequest: path }),
  takeAgentRequest: () => {
    const path = get().agentRequest;
    if (path !== undefined) set({ agentRequest: undefined });
    return path;
  },
  requestBehaviorsWorkflow: (path) => set({ behaviorsRequest: path }),
  takeBehaviorsRequest: () => {
    const path = get().behaviorsRequest;
    if (path !== undefined) set({ behaviorsRequest: undefined });
    return path;
  },
  catalogChanged: () => set((state) => ({ catalogVersion: state.catalogVersion + 1 })),
  begin: (workflowId) =>
    set((state) => ({ runs: { ...state.runs, [workflowId]: { status: "running", steps: {}, startedAt: Date.now(), lastActivityAt: Date.now() } } })),
  touchRunning: () =>
    set((state) => {
      const now = Date.now();
      const runs = Object.fromEntries(Object.entries(state.runs).map(([id, run]) => [id, run.status === "running" ? { ...run, lastActivityAt: now } : run]));
      return { runs };
    }),
  step: (workflowId, progress) =>
    set((state) => {
      const run = state.runs[workflowId] ?? { status: "running" as const, steps: {}, startedAt: Date.now(), lastActivityAt: Date.now() };
      const active = progress.status === "running" || progress.status === "waiting" || progress.status === "retry";
      return {
        runs: {
          ...state.runs,
          [workflowId]: { ...run, lastActivityAt: Date.now(), current: active ? progress.nodeId : run.current, steps: { ...run.steps, [progress.nodeId]: progress } },
        },
      };
    }),
  finish: (workflowId, status, error) =>
    set((state) => {
      const run = state.runs[workflowId];
      if (!run) return {};
      return { runs: { ...state.runs, [workflowId]: { ...run, status, error, current: undefined } } };
    }),
}));
