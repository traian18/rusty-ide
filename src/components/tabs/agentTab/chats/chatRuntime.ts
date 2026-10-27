import { useWorkspaceStore } from "../../../../store";
import { ActivityLog } from "../activityLog";
import { createTurnState, type TurnState } from "../turn";

/** What an open chat keeps outside React for its runs: their mutable state and the activity log
 * their console messages are written through. Lives as long as the chat is open. */
export interface ChatRuntime {
  state: TurnState;
  activity: ActivityLog;
}

const runtimes = new Map<string, ChatRuntime>();

/** Whether `runtime` is still the open chat's: a run of a chat that was closed (and whose id may be
 * reused) writes nowhere. */
export function isCurrentRuntime(chatId: string, runtime: ChatRuntime): boolean {
  return runtimes.get(chatId) === runtime;
}

/** The chat's runtime, created the first time the chat is used. */
export function chatRuntime(chatId: string): ChatRuntime {
  let runtime = runtimes.get(chatId);
  if (!runtime) {
    const created: ChatRuntime = {
      state: createTurnState(),
      activity: new ActivityLog({
        add: (message) => isCurrentRuntime(chatId, created) && useWorkspaceStore.getState().addAgentMessage(chatId, message),
        update: (id, content, entries) => isCurrentRuntime(chatId, created) && useWorkspaceStore.getState().updateAgentMessage(chatId, id, content, entries),
      }),
    };
    runtime = created;
    runtimes.set(chatId, runtime);
  }
  return runtime;
}

/** Forgets a closed chat's runtime. */
export function disposeChatRuntime(chatId: string): void {
  const runtime = runtimes.get(chatId);
  if (!runtime) return;
  runtime.activity.cancelScheduledFlush();
  runtime.state.disposed = true;
  runtimes.delete(chatId);
}
