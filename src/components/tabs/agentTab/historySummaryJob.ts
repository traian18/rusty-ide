import type { ContextCompactionRunConfig } from "../../../harness/core/decideToolConfig";
import { historyBudgetChars } from "../../../harness/core/contextCompaction";
import { historyTurnsOf, refreshHistorySummary, type HistorySummary } from "../../../services/historySummary";
import { useWorkspaceStore, type CustomProvider } from "../../../store";
import type { TurnState } from "./turn";

/** Drops the running summary (and any pass still producing one) when the
 * conversation changes; `next` is the summary saved with the chat now shown. */
export function resetSummary(state: TurnState, next?: HistorySummary) {
  state.historySummaryJob?.abort();
  state.historySummaryJob = null;
  state.historySummary = next;
}

interface SummaryChat {
  state: TurnState;
  chatId: string;
  rootPath: string;
  /** Saves the chat, with its new summary. */
  save(): Promise<void>;
}

/** Smart compaction for earlier turns: after a run, refresh the running
 * summary in the background so the next run's prompt can use it. Never
 * delays a run; a failed pass keeps the previous summary. */
export function refreshSummaryInBackground(chat: SummaryChat, provider: CustomProvider, model: string, compaction: ContextCompactionRunConfig) {
  const { state } = chat;
  if (compaction.mode !== "smart" || !compaction.jev) return;
  const budgetChars = historyBudgetChars(provider, model);
  if (!budgetChars || state.historySummaryJob) return;
  const conversation = state.chatSaveQueue;
  const controller = new AbortController();
  state.historySummaryJob = controller;
  void refreshHistorySummary({
    turns: historyTurnsOf(useWorkspaceStore.getState().agentChats[chat.chatId] || []),
    previous: state.historySummary,
    budgetChars,
    provider,
    model,
    jev: compaction.jev,
    workspaceRoot: chat.rootPath,
    tabId: chat.chatId,
    signal: controller.signal,
  })
    .then((next) => {
      // The chat may have been switched or cleared while this ran.
      if (!next || controller.signal.aborted || state.chatSaveQueue !== conversation) return;
      state.historySummary = next;
      void chat.save();
    })
    .catch((error) => console.warn("Could not refresh the chat's earlier-turns summary; keeping the previous one:", error))
    .finally(() => {
      if (state.historySummaryJob === controller) state.historySummaryJob = null;
    });
}
