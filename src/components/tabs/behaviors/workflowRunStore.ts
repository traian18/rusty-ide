/**
 * workflowRunStore — how each workflow's latest run is going, shared between
 * the Agent tab (which runs it) and the Behaviors canvas (which shows each
 * step's status on its node), plus one-shot hand-offs between the two tabs.
 * Which workflow a chat follows belongs to that chat (saved in its file),
 * not to this store. Each Agent chat also has its own latest run here, so
 * two chats running the same workflow do not show each other's steps.
 *
 * Deliberately a small standalone store, like notificationStore: nothing
 * here needs persisting or belongs to the workspace store's slices.
 */

import { create } from "zustand";
import type { WorkflowStepProgress } from "../../../harness/core/workflowRun";

export type WorkflowRunStatus = "running" | "completed" | "failed" | "cancelled";

/** Research a step asked for while it ran: shown in the bar right after that step. */
export interface WorkflowResearchProgress {
  callId: string;
  /** The step that asked. */
  nodeId: string;
  question: string;
  status: "running" | "done" | "failed";
}

export interface WorkflowRunView {
  /** The workflow that runs (set on a chat's run). */
  workflowId?: string;
  status: WorkflowRunStatus;
  steps: Record<string, WorkflowStepProgress>;
  /** Research steps inserted on demand, oldest first. */
  research?: WorkflowResearchProgress[];
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
  /** Latest run per workflow id, whichever chat ran it (the Behaviors canvas). */
  runs: Record<string, WorkflowRunView>;
  /** Latest run per Agent chat id (that chat's workflow bar). */
  chatRuns: Record<string, WorkflowRunView>;
  requestAgentWorkflow(path: string): void;
  takeAgentRequest(): string | undefined;
  requestBehaviorsWorkflow(path: string): void;
  takeBehaviorsRequest(): string | undefined;
  catalogChanged(): void;
  /** `chatId`, when given, is the Agent chat the run belongs to; the run is then also that chat's. */
  begin(workflowId: string, chatId?: string): void;
  /** Record activity on the chat's run (and the workflow's latest run) while it goes; without a chat, on every run that is still going. */
  touchRunning(chatId?: string): void;
  step(workflowId: string, progress: WorkflowStepProgress, chatId?: string): void;
  research(workflowId: string, progress: WorkflowResearchProgress, chatId?: string): void;
  finish(workflowId: string, status: Exclude<WorkflowRunStatus, "running">, error?: string, chatId?: string): void;
  /** Forgets a closed chat's run. */
  forgetChat(chatId: string): void;
}

type RunUpdate = (run: WorkflowRunView | undefined) => WorkflowRunView | undefined;

/** Applies `update` to the workflow's latest run and, with a chat, to that chat's run. */
function updateRuns(state: Pick<WorkflowRunStore, "runs" | "chatRuns">, workflowId: string, chatId: string | undefined, update: RunUpdate) {
  const latest = update(state.runs[workflowId]);
  const runs = latest ? { ...state.runs, [workflowId]: latest } : state.runs;
  if (!chatId) return { runs };
  const own = state.chatRuns[chatId];
  const chat = own?.workflowId === workflowId ? update(own) : undefined;
  return { runs, chatRuns: chat ? { ...state.chatRuns, [chatId]: chat } : state.chatRuns };
}

/** How often a sign of life is recorded. Runs send many events a second (every token); recording each
 * re-rendered every view of the runs, the Behaviors canvas included, and the app stuttered. */
export const ACTIVITY_RESOLUTION_MS = 1000;

/** The run with its activity moved to `now`, or undefined when it is not running or was touched just now. */
function stillGoing(run: WorkflowRunView | undefined, now: number): WorkflowRunView | undefined {
  return run?.status === "running" && now - run.lastActivityAt >= ACTIVITY_RESOLUTION_MS ? { ...run, lastActivityAt: now } : undefined;
}

export const useWorkflowRunStore = create<WorkflowRunStore>((set, get) => ({
  agentRequest: undefined,
  behaviorsRequest: undefined,
  catalogVersion: 0,
  runs: {},
  chatRuns: {},
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
  begin: (workflowId, chatId) =>
    set((state) => {
      const run: WorkflowRunView = { status: "running", steps: {}, startedAt: Date.now(), lastActivityAt: Date.now() };
      return {
        runs: { ...state.runs, [workflowId]: run },
        ...(chatId ? { chatRuns: { ...state.chatRuns, [chatId]: { ...run, workflowId } } } : {}),
      };
    }),
  touchRunning: (chatId) =>
    set((state) => {
      const now = Date.now();
      if (!chatId) {
        const touched = Object.entries(state.runs).flatMap(([id, run]) => {
          const next = stillGoing(run, now);
          return next ? [[id, next] as const] : [];
        });
        return touched.length > 0 ? { runs: { ...state.runs, ...Object.fromEntries(touched) } } : state;
      }
      const workflowId = state.chatRuns[chatId]?.workflowId;
      const chatRun = stillGoing(state.chatRuns[chatId], now);
      const latest = workflowId ? stillGoing(state.runs[workflowId], now) : undefined;
      if (!chatRun && !latest) return state;
      return {
        ...(latest ? { runs: { ...state.runs, [workflowId!]: latest } } : {}),
        ...(chatRun ? { chatRuns: { ...state.chatRuns, [chatId]: chatRun } } : {}),
      };
    }),
  step: (workflowId, progress, chatId) =>
    set((state) => updateRuns(state, workflowId, chatId, (existing) => {
      const run = existing ?? { status: "running" as const, steps: {}, startedAt: Date.now(), lastActivityAt: Date.now() };
      const active = progress.status === "running" || progress.status === "waiting" || progress.status === "retry";
      return { ...run, lastActivityAt: Date.now(), current: active ? progress.nodeId : run.current, steps: { ...run.steps, [progress.nodeId]: progress } };
    })),
  research: (workflowId, progress, chatId) =>
    set((state) => updateRuns(state, workflowId, chatId, (run) => {
      if (!run) return undefined;
      const research = run.research ?? [];
      const index = research.findIndex((item) => item.callId === progress.callId);
      const next = index >= 0 ? research.map((item, at) => (at === index ? { ...item, status: progress.status } : item)) : [...research, progress];
      return { ...run, lastActivityAt: Date.now(), research: next };
    })),
  finish: (workflowId, status, error, chatId) =>
    set((state) => updateRuns(state, workflowId, chatId, (run) => run && { ...run, status, error, current: undefined })),
  forgetChat: (chatId) =>
    set((state) => {
      if (!(chatId in state.chatRuns)) return {};
      const { [chatId]: _forgotten, ...chatRuns } = state.chatRuns;
      return { chatRuns };
    }),
}));
