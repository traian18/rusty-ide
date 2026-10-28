// ============================================================
// agentTab/goalTurn.ts -- goal loops in a chat: the /goal command, and after each pass (one
// single-agent run) the host's measurement and decision, then the next pass or the end. The
// model never ends a goal by saying it is done; the measurement does (see harness-goals).
// ============================================================

import { goalClient, type GoalStep, type PassCheckOutcome, type PassReport } from "../../../goals/goalClient";
import { parseGoalCommand } from "../../../goals/goalCommand";
import { workspaceRelative } from "../../../harness/core/definitions/guidelinesTool";
import { notify } from "../../../notificationStore";
import { repositoryContextInput } from "../../../services/repositoryContextInput";
import { useWorkspaceStore } from "../../../store";
import { addAssistantMessage, DEFAULT_STREAMING_LABEL, nextMessageId, type AgentTurn } from "./turn";

/** The pass of a goal a run is. */
export interface GoalPass {
  id: string;
  pass: number;
  /** The checks the goal requires. */
  checks: string[];
}

/** Starts a run for a pass: the chat's send path with the pass attached. */
export type SendPass = (prompt: string, pass: GoalPass) => Promise<void>;

/** What a finished pass left: its answer, changed files and the checks it ran. */
export interface PassResult {
  response: string;
  modifiedFiles: string[];
  checks?: PassCheckOutcome[];
}

function activeRepository(root: string): string | undefined {
  const context = repositoryContextInput(useWorkspaceStore.getState(), root) as { activeRepository?: string } | undefined;
  return context?.activeRepository;
}

function failure(error: unknown): string {
  if (typeof error === "object" && error !== null && "message" in error) return String((error as { message: unknown }).message);
  return String(error);
}

/** The last `Name: value` line of `text`, lower-cased, without markdown around it. */
function lastLine(text: string, name: string): string | undefined {
  const pattern = new RegExp(`^\\W*${name}\\s*:\\s*(.+)$`, "i");
  const lines = text.split("\n").map((line) => line.trim().replace(/[*_`]/g, "")).reverse();
  const found = lines.map((line) => pattern.exec(line)).find(Boolean);
  return found?.[1]?.trim();
}

/** What the pass said about itself: its status line, and its judgement of a goal in words. */
export function passReport(response: string): PassReport {
  const status = lastLine(response, "status");
  const judged = lastLine(response, "done when");
  const report: PassReport = {};
  if (status) report.agent_status = status;
  if (judged) {
    report.done_when_met = /^yes\b/i.test(judged);
    report.judge_reason = judged.replace(/^(yes|no)\b\W*/i, "") || undefined;
  }
  return report;
}

/** Every check the pass ran, and each required one it did not run counted as not run. */
export function passChecks(required: string[], ran: PassCheckOutcome[] = []): PassCheckOutcome[] {
  const missing = required.filter((name) => !ran.some((check) => check.name === name));
  return [...ran, ...missing.map((name) => ({ name, passed: false, ran: false, summary: "not run" }))];
}

function passOf(step: GoalStep): GoalPass {
  return { id: step.goal.id, pass: step.goal.passes + 1, checks: step.goal.targets.checks };
}

const VERDICTS: Record<string, string> = {
  done: "goal reached",
  continue: "progress",
  undone: "undone (made it worse)",
  no_progress: "no progress",
  blocked: "blocked",
  budget: "budget used",
};

function passMessage(step: GoalStep, pass: number): string {
  const decision = step.decision;
  if (!decision) return step.status;
  const lines = [`**Goal pass ${pass}: ${VERDICTS[decision.verdict] ?? decision.verdict}.** ${decision.reason}`, decision.summary];
  if (step.undone.length > 0) lines.push(`Put back: ${step.undone.join(", ")}.`);
  if (decision.unmet.length > 0 && decision.verdict !== "done") lines.push(`Not met: ${decision.unmet.map((u) => u.target).join("; ")}.`);
  return lines.join("\n\n");
}

/** The goal of this chat that a control applies to: the most recent one that is not cleared. */
async function chatGoal(turn: AgentTurn): Promise<GoalStep | undefined> {
  const goals = await goalClient.list(turn.rootPath);
  return goals.find((step) => step.goal.chat_id === turn.chatId && step.goal.status !== "cleared");
}

async function start(turn: AgentTurn, command: Extract<ReturnType<typeof parseGoalCommand>, { kind: "start" }>, send: SendPass) {
  turn.ui.setStreamingLabel("Measuring the goal's scope…");
  const step = await goalClient.create(turn.rootPath, activeRepository(turn.rootPath), command, turn.chatId)
    .finally(() => turn.ui.setStreamingLabel(DEFAULT_STREAMING_LABEL));
  addAssistantMessage(turn, `${step.status}\n\nStarting pass 1.`);
  if (!step.prompt) return;
  const pass = passOf(step);
  turn.state.goal = pass;
  await send(step.prompt, pass);
}

/**
 * Handles a /goal message: starts a goal (its first pass is sent with `send`), or shows,
 * pauses, resumes or clears the chat's goal.
 */
export async function handleGoalCommand(turn: AgentTurn, draft: string, attached: string[], send: SendPass): Promise<void> {
  turn.addMessage({ id: nextMessageId(), role: "user", content: draft.trim(), timestamp: new Date().toISOString() });
  const command = parseGoalCommand(draft, attached.map((path) => workspaceRelative(turn.rootPath, path)));
  try {
    if (command.kind === "invalid") {
      addAssistantMessage(turn, `The goal was not started: ${command.message}`);
      return;
    }
    if (command.kind === "start") {
      await start(turn, command, send);
      return;
    }
    const current = await chatGoal(turn);
    if (!current) {
      addAssistantMessage(turn, "This chat has no goal. Start one with /goal <what to do>.");
      return;
    }
    if (command.kind === "status") {
      addAssistantMessage(turn, current.status);
      return;
    }
    const step = await goalClient.control(turn.rootPath, activeRepository(turn.rootPath), current.goal.id, command.kind);
    turn.state.goal = undefined;
    if (command.kind === "clear") {
      addAssistantMessage(turn, "Goal cleared.");
      return;
    }
    addAssistantMessage(turn, step.status);
    if (command.kind === "resume" && step.prompt) {
      const pass = passOf(step);
      turn.state.goal = pass;
      await send(step.prompt, pass);
    }
  } catch (error: unknown) {
    addAssistantMessage(turn, `Goal: ${failure(error)}`);
    notify("Goal", failure(error), "error");
  }
}

/**
 * After a pass completed: the host measures and decides; the next pass starts while the goal
 * runs. A goal paused or cleared meanwhile (by a command, or by a message from the user) stops.
 */
export async function continueGoal(turn: AgentTurn, pass: GoalPass, result: PassResult, send: SendPass): Promise<void> {
  if (turn.state.disposed) return;
  try {
    const touched = result.modifiedFiles.map((file) => workspaceRelative(turn.rootPath, file));
    const step = await goalClient.afterPass(turn.rootPath, activeRepository(turn.rootPath), pass.id, passReport(result.response), passChecks(pass.checks, result.checks), touched);
    if (turn.state.disposed) return;
    addAssistantMessage(turn, passMessage(step, pass.pass));
    void turn.chat.save();
    if (step.goal.status === "running" && step.prompt && turn.state.goal?.id === pass.id && !turn.state.isStreaming) {
      const next = passOf(step);
      turn.state.goal = next;
      await send(step.prompt, next);
      return;
    }
    if (turn.state.goal?.id === pass.id) turn.state.goal = undefined;
    if (step.goal.status === "done") notify("Goal reached", step.goal.instruction, "success");
    else if (step.goal.status !== "running") notify("Goal paused", step.goal.reason ?? step.goal.status, "info");
  } catch (error: unknown) {
    turn.state.goal = undefined;
    addAssistantMessage(turn, `Goal: the pass could not be measured: ${failure(error)}. Resume with /goal resume.`);
  }
}

/** A pass that failed or was stopped pauses its goal, so it never runs on unattended. */
export async function pauseGoal(turn: AgentTurn, pass: GoalPass, reason: string): Promise<void> {
  if (turn.state.goal?.id === pass.id) turn.state.goal = undefined;
  try {
    await goalClient.control(turn.rootPath, activeRepository(turn.rootPath), pass.id, "pause", reason);
    if (!turn.state.disposed) addAssistantMessage(turn, `Goal paused: ${reason} Resume with /goal resume.`);
  } catch {
    // The goal file may be gone (cleared); nothing is left to pause.
  }
}
