import { useEffect, useRef, useState } from "react";
import type { AgentMessage } from "../../../store/types";

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

/**
 * The chat's last message is a run stopped by a usage limit: offers to go on
 * by itself once the limit resets (sending "continue", which resumes the
 * failed run and keeps its finished tasks). `undefined` otherwise.
 */
export function useUsageLimitContinue(messages: readonly AgentMessage[], busy: boolean, onContinue: () => void): UsageLimitContinue | undefined {
  const last = messages[messages.length - 1];
  const resetsAt = last?.role === "assistant" ? usageLimitReset(last.content) : undefined;
  const key = resetsAt?.toISOString();
  const [scheduled, setScheduled] = useState(false);
  const latest = useRef({ busy, onContinue });
  latest.current = { busy, onContinue };

  // Another failure, or a new message: whatever was scheduled is off.
  useEffect(() => setScheduled(false), [key]);

  useEffect(() => {
    if (!scheduled || !key) return;
    const timer = setTimeout(() => {
      setScheduled(false);
      if (!latest.current.busy) latest.current.onContinue();
    }, continueDelay(new Date(key), Date.now()));
    return () => clearTimeout(timer);
  }, [scheduled, key]);

  if (!resetsAt) return undefined;
  return { resetsAt, scheduled, schedule: () => setScheduled(true), cancel: () => setScheduled(false) };
}
