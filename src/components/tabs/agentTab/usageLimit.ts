import type { AgentMessage } from "../../../store/types";
import type { AgentTurn } from "./turn";

/** How long after the reset the run goes on, so the provider has surely let go. */
export const CONTINUE_AFTER_RESET_MS = 60_000;

/** The message sent to go on with the run. */
export const CONTINUE_MESSAGE = "continue";

/** When a run stopped by the model provider's usage limit can go on: the
 * `resets_at=` time rusty-core writes into such a failure. */
export function usageLimitReset(text: string | undefined): Date | undefined {
  const match = text?.match(/resets_at=(\d{4}-\d{2}-\d{2}T[\d:.]+Z)/);
  if (!match) return undefined;
  const at = new Date(match[1]);
  return Number.isNaN(at.getTime()) ? undefined : at;
}

/** How long to wait from `now` before continuing after `resetsAt`. */
export function continueDelay(resetsAt: Date, now: number): number {
  return Math.max(0, resetsAt.getTime() + CONTINUE_AFTER_RESET_MS - now);
}

export interface UsageLimitContinue {
  resetsAt: Date;
  scheduled: boolean;
  schedule: () => void;
  cancel: () => void;
}

/** Stops the chat's scheduled continue, if it has one. */
export function cancelContinue(turn: AgentTurn) {
  if (turn.state.continueTimer) clearTimeout(turn.state.continueTimer);
  turn.state.continueTimer = null;
  turn.ui.setContinueAt(undefined);
}

/**
 * Continues this chat by itself once the limit resets: the timer belongs to the chat it was
 * scheduled in (not to whichever chat is shown when it fires), is stopped when that chat is closed
 * or gets another message, and sends nothing while it is busy.
 */
export function scheduleContinue(turn: AgentTurn, resetsAt: Date, send: (turn: AgentTurn) => void) {
  cancelContinue(turn);
  turn.ui.setContinueAt(resetsAt.toISOString());
  turn.state.continueTimer = setTimeout(() => {
    turn.state.continueTimer = null;
    turn.ui.setContinueAt(undefined);
    if (!turn.state.disposed && !turn.state.isStreaming) send(turn);
  }, continueDelay(resetsAt, Date.now()));
}

/**
 * The chat's last message is a run stopped by a usage limit: offers to go on by itself once the
 * limit resets (sending "continue", which resumes the failed run and keeps its finished tasks).
 * `undefined` otherwise. It only reads; scheduling is the chat's (`scheduleContinue`).
 */
export function usageLimitOffer(
  messages: readonly AgentMessage[],
  continueAt: string | undefined,
  actions: { schedule: (resetsAt: Date) => void; cancel: () => void },
): UsageLimitContinue | undefined {
  const last = messages[messages.length - 1];
  const resetsAt = last?.role === "assistant" ? usageLimitReset(last.content) : undefined;
  if (!resetsAt) return undefined;
  return {
    resetsAt,
    scheduled: continueAt === resetsAt.toISOString(),
    schedule: () => actions.schedule(resetsAt),
    cancel: actions.cancel,
  };
}
