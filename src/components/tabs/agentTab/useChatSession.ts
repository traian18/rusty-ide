import { useState } from "react";
import type { ContextCompactionRunConfig } from "../../../harness/core/decideToolConfig";
import { readWorkflowCheckpoint, type FailedWorkflowCheckpoint } from "../../../harness/core/workflowRun";
import { notify } from "../../../notificationStore";
import { AgentChatSaveQueue, readChatWorkflow, readFlowSwitching, readFollowedSpec, readModifiedFiles } from "../../../services/agentChatPersistence";
import { readHistorySummary, type HistorySummary } from "../../../services/historySummary";
import { refreshSummaryInBackground, resetSummary } from "./historySummaryJob";
import { useWorkspaceStore, type CustomProvider } from "../../../store";
import type { SavedChatFile } from "./savedChats";
import type { TurnState } from "./turn";

interface Persist {
  persist?: boolean;
}

/** The conversation the tab shows as a saved chat: where it is saved, and
 * what is saved with it (changed files, the workflow it follows, flow
 * switching, a failed run's checkpoint, the earlier-turns summary). */
export function useChatSession(tabId: string, rootPath: string, state: TurnState, onSaved: () => Promise<void>) {
  const [activeChatPath, setActiveChatPath] = useState<string | null>(null);
  const [modifiedFiles, setModifiedFilesState] = useState<string[]>([]);
  const [chatWorkflow, setChatWorkflowState] = useState<string | undefined>();
  // With Auto, the workflow chosen for the latest message (drives the bar's steps).
  const [autoWorkflow, setAutoWorkflow] = useState<string | undefined>();
  const [flowSwitching, setFlowSwitchingState] = useState(false);
  const [workflowCheckpoint, setWorkflowCheckpointState] = useState<FailedWorkflowCheckpoint>();
  const hasMessages = () => (useWorkspaceStore.getState().agentChats[tabId] || []).length > 0;

  const save = async () => {
    if (!rootPath) return;
    // Snapshot synchronously: closing the tab removes its messages from
    // the store, and a later render may belong to a different conversation.
    const messages = useWorkspaceStore.getState().agentChats[tabId] || [];
    const queue = state.chatSaveQueue;
    try {
      await queue.save(rootPath, tabId, messages, state.modifiedFiles, state.chatWorkflow, state.workflowCheckpoint, state.flowSwitching, state.historySummary, state.followedSpec);
      if (state.chatSaveQueue === queue) setActiveChatPath(queue.path);
      await onSaved();
    } catch (error) {
      console.error("Failed to save chat history:", error);
      notify("Chat not saved", "Could not save this conversation. Please check workspace access.", "error");
    }
  };

  const setModifiedFiles = (files: string[]) => {
    state.modifiedFiles = readModifiedFiles(files);
    setModifiedFilesState(state.modifiedFiles);
  };
  const setWorkflowCheckpoint = (value: unknown) => {
    const checkpoint = readWorkflowCheckpoint(value);
    state.workflowCheckpoint = checkpoint;
    setWorkflowCheckpointState(checkpoint);
  };
  /** Which workflow this chat follows. A conversation already on disk
   * remembers the choice right away; a new one saves it with its first message. */
  const setChatWorkflow = (path: string | undefined, { persist = true }: Persist = {}) => {
    setWorkflowCheckpoint(undefined);
    state.chatWorkflow = path;
    setChatWorkflowState(path);
    setAutoWorkflow(undefined);
    if (persist && hasMessages()) void save();
  };
  /** The followed workflow turned out to be the built-in one under another path: follow it by its own. */
  const adoptChatWorkflowPath = (path: string) => {
    state.chatWorkflow = path;
    setChatWorkflowState(path);
  };
  const setFlowSwitching = (allowed: boolean, { persist = true }: Persist = {}) => {
    state.flowSwitching = allowed;
    setFlowSwitchingState(allowed);
    if (persist && hasMessages()) void save();
  };

  const resetHistorySummary = (next?: HistorySummary) => resetSummary(state, next);
  const refreshHistorySummary = (provider: CustomProvider, model: string, compaction: ContextCompactionRunConfig) => {
    if (rootPath) refreshSummaryInBackground({ state, tabId, rootPath, save }, provider, model, compaction);
  };

  /** Starts a conversation that is not saved yet. */
  const reset = () => {
    setActiveChatPath(null);
    state.chatSaveQueue = new AgentChatSaveQueue();
    resetHistorySummary();
    setModifiedFiles([]);
    setChatWorkflow(undefined, { persist: false });
    setFlowSwitching(false, { persist: false });
    state.lastWorkflowRun = undefined;
    state.followedSpec = undefined;
  };

  /** Shows the chat saved at `path`, as `file` holds it. */
  const restore = (path: string, file: SavedChatFile) => {
    setActiveChatPath(path);
    state.chatSaveQueue = new AgentChatSaveQueue(path);
    resetHistorySummary(readHistorySummary(file.historySummary));
    setModifiedFiles(readModifiedFiles(file.modifiedFiles));
    setChatWorkflow(readChatWorkflow(file.workflow), { persist: false });
    setFlowSwitching(readFlowSwitching(file.flowSwitching), { persist: false });
    state.lastWorkflowRun = undefined;
    setWorkflowCheckpoint(file.workflowCheckpoint);
    state.followedSpec = readFollowedSpec(file.followedSpec);
  };

  /** The saved chat at `path` was deleted: if it is the one shown, it is no longer saved. */
  const forget = (path: string) => {
    if (activeChatPath !== path) return;
    setActiveChatPath(null);
    state.chatSaveQueue = new AgentChatSaveQueue();
  };

  /** Where this chat is being saved, once it has been. */
  const savingTo = () => state.chatSaveQueue.path;

  /** Waits for this chat's pending saves. A failed save was already reported. */
  const saved = (what: string) => state.chatSaveQueue.flushed().catch((error) => {
    console.warn(`An earlier save of this chat failed; ${what} anyway:`, error);
  });

  return {
    activeChatPath, modifiedFiles, chatWorkflow, autoWorkflow, setAutoWorkflow, flowSwitching, workflowCheckpoint,
    save, saved, savingTo, setModifiedFiles, setWorkflowCheckpoint, setChatWorkflow, adoptChatWorkflowPath, setFlowSwitching,
    refreshHistorySummary, reset, restore, forget,
  };
}

export type ChatSession = ReturnType<typeof useChatSession>;
