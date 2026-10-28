// ============================================================
// autoMode.ts -- Auto mode: nothing waits for the user. While it is on, every
// run answers its own prompts (see `withAutoMode` in hostDefaults.ts):
//  - commands and file writes are allowed (once each, no session grant);
//  - a question takes its first suggestion, or the agent is told to decide;
//  - a workflow step is approved; a failed task is tried once more, then skipped.
// It is one switch for the whole app, remembered across restarts, and takes
// effect at once: turning it on also answers what is waiting now.
// ============================================================

import type { CommandPermissionDecision } from "../../shared/agent-protocol";
import type { AgentQuestion, WorkflowAnswer, WorkflowQuestion } from "./contract";

const KEY = "rusty_auto_mode";

type Listener = (on: boolean) => void;
const listeners = new Set<Listener>();

function read(): boolean {
  try {
    return localStorage.getItem(KEY) === "true";
  } catch (error) {
    console.warn("Could not read the auto mode preference; it starts off:", error);
    return false;
  }
}

let on = read();

export function isAutoMode(): boolean {
  return on;
}

export function setAutoMode(enabled: boolean): void {
  if (enabled === on) return;
  on = enabled;
  try {
    localStorage.setItem(KEY, String(enabled));
  } catch (error) {
    console.warn("Could not remember the auto mode preference; it applies to this session only:", error);
  }
  for (const listener of [...listeners]) listener(enabled);
}

/** Called whenever auto mode is turned on or off; returns the unsubscribe. */
export function onAutoMode(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** What auto mode answers a command or file-write permission. */
export const AUTO_PERMISSION: CommandPermissionDecision = "allow_once";

/** The answer when a question offers no suggestion. */
export const AUTO_DECIDE =
  "Auto mode is on, so nobody will answer. Decide yourself from the evidence you have, say in your final answer what you chose and why, and carry on.";

export function autoQuestionAnswer(question: AgentQuestion): string {
  return question.options[0]?.label ?? AUTO_DECIDE;
}

/** Failed tasks auto mode has already tried once more, by the request id without its question number. */
const retried = new Set<string>();

/** Decisions auto mode takes, best first, when the question offers them. */
const PREFERRED = ["approve", "accept", "continue"];
const NEVER = new Set(["stop", "reject", "cancel"]);

export function autoWorkflowAnswer(question: WorkflowQuestion): WorkflowAnswer {
  const offered = (id: string) => question.decisions.some((decision) => decision.id === id);
  const preferred = PREFERRED.find(offered);
  if (preferred) return { decision: preferred, auto: true };
  if (question.kind === "task_failure") {
    const task = question.requestId.replace(/:\d+$/, "");
    if (offered("retry") && !retried.has(task)) {
      retried.add(task);
      return { decision: "retry", text: "Auto mode: try once more, with a different approach if the first one failed for a reason it can't get past.", auto: true };
    }
    if (offered("skip")) return { decision: "skip", auto: true };
  }
  const choice = question.decisions.find((decision) => !decision.requiresText && !NEVER.has(decision.id))
    ?? question.decisions.find((decision) => !NEVER.has(decision.id))
    ?? question.decisions[0];
  return { decision: choice?.id ?? "approve", ...(choice?.requiresText ? { text: "Auto mode: decided without the user." } : {}), auto: true };
}

/** Asks with `ask` while auto mode is off; answers with `auto()` at once when it is on, or as soon
 * as it is turned on while the question waits (the question is then withdrawn). */
export function unlessAuto<T>(auto: () => T, ask: (signal: AbortSignal) => Promise<T>, signal: AbortSignal): Promise<T> {
  if (on) return Promise.resolve(auto());
  const asking = new AbortController();
  const stop = () => asking.abort();
  signal?.addEventListener("abort", stop, { once: true });
  return new Promise<T>((resolve, reject) => {
    const unsubscribe = onAutoMode((enabled) => {
      if (!enabled) return;
      done();
      resolve(auto());
      asking.abort();
    });
    const done = () => {
      unsubscribe();
      signal?.removeEventListener("abort", stop);
    };
    ask(asking.signal).then(
      (answer) => {
        done();
        resolve(answer);
      },
      (error: unknown) => {
        done();
        reject(error);
      },
    );
  });
}
