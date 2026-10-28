// ============================================================
// goals/goalClient.ts -- the host's goal commands (src-tauri/src/goals). The goal itself is
// rusty-core's harness-goals `Goal`, in its own snake_case; the step around it is camelCase.
// ============================================================

import { invoke } from "@tauri-apps/api/core";

import type { GoalStart } from "./goalCommand";

export type GoalStatus = "running" | "paused" | "done" | "blocked" | "cleared";
export type Verdict = "done" | "continue" | "undone" | "no_progress" | "blocked" | "budget";

export interface Goal {
  id: string;
  status: GoalStatus;
  instruction: string;
  scope: string[];
  scope_note?: string;
  targets: { min_file_health?: number; min_mean_health?: number; max_severity?: string; checks: string[]; guidelines: boolean; done_when?: string };
  budget: { max_passes: number; no_progress_passes: number };
  chat_id?: string;
  passes: number;
  reason?: string;
}

export interface GoalDecision {
  verdict: Verdict;
  status: GoalStatus;
  unmet: Array<{ target: string; detail: string }>;
  undo: boolean;
  reason: string;
  summary: string;
}

export interface GoalStep {
  goal: Goal;
  /** The next pass's message, while the goal runs. */
  prompt?: string | null;
  status: string;
  decision?: GoalDecision | null;
  undone: string[];
}

export interface PassCheckOutcome { name: string; passed: boolean; ran: boolean; summary: string }
export interface PassReport { agent_status?: string; done_when_met?: boolean; judge_reason?: string; next?: string; plan?: Array<{ content: string; status: string }> }

const now = () => new Date().toISOString();

export const goalClient = {
  create(root: string, activeRepository: string | undefined, start: GoalStart, chatId: string): Promise<GoalStep> {
    const { targets } = start;
    return invoke("goal_create", {
      root,
      activeRepository: activeRepository ?? null,
      request: {
        instruction: start.instruction,
        scope: start.scope,
        scopeNote: start.scopeNote ?? null,
        targets: { min_file_health: targets.minFileHealth, min_mean_health: targets.minMeanHealth, max_severity: targets.maxSeverity, checks: targets.checks, guidelines: targets.guidelines, done_when: targets.doneWhen },
        budget: start.maxPasses ? { max_passes: start.maxPasses, no_progress_passes: 2 } : null,
        keepBest: start.keepBest,
        chatId,
      },
      now: now(),
    });
  },

  afterPass(root: string, activeRepository: string | undefined, id: string, report: PassReport, checks: PassCheckOutcome[], touched: string[]): Promise<GoalStep> {
    return invoke("goal_after_pass", { root, activeRepository: activeRepository ?? null, id, report, checks, touched, now: now() });
  },

  control(root: string, activeRepository: string | undefined, id: string, action: "pause" | "resume" | "clear", reason?: string): Promise<GoalStep> {
    return invoke("goal_control", { root, activeRepository: activeRepository ?? null, id, action, reason: reason ?? null, now: now() });
  },

  list(root: string): Promise<GoalStep[]> {
    return invoke("goal_list", { root });
  },
};
