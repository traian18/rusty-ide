import type { ContextCompactionRunConfig } from "../../../../harness/core/decideToolConfig";
import { readWorkflowCheckpoint } from "../../../../harness/core/workflowRun";
import { notify } from "../../../../notificationStore";
import { AgentChatSaveQueue, readChatWorkflow, readFlowSwitching, readFollowedSpec, readModifiedFiles } from "../../../../services/agentChatPersistence";
import { readHistorySummary, type HistorySummary } from "../../../../services/historySummary";
import { refreshSummaryInBackground, resetSummary } from "../historySummaryJob";
import { useWorkspaceStore, type CustomProvider } from "../../../../store";
import type { SavedChatFile } from "../savedChats";
import { isCurrentRuntime, type ChatRuntime } from "./chatRuntime";
import { useChatStore, type ChatView } from "./chatStore";

interface Persist {
  persist?: boolean;
}

/** A chat as a saved conversation: where it is saved, and what is saved with
 * it (changed files, the workflow it follows, flow switching, a failed run's
 * checkpoint, the earlier-turns summary). Writes to that chat's view, whichever
 * chat is shown. */
export function chatSession(chatId: string, rootPath: string, runtime: ChatRuntime, onSaved: () => Promise<void>) {
  const { state } = runtime;
  const patch = (change: Partial<ChatView>) => {
    if (isCurrentRuntime(chatId, runtime)) useChatStore.getState().patch(chatId, change);
  };
  const setActiveChatPath = (activeChatPath: string | null) => patch({ activeChatPath });
  const setModifiedFilesState = (modifiedFiles: string[]) => patch({ modifiedFiles });
  const setChatWorkflowState = (chatWorkflow: string | undefined) => patch({ chatWorkflow });
  const setAutoWorkflow = (autoWorkflow: string | undefined) => patch({ autoWorkflow });
  const setFlowSwitchingState = (flowSwitching: boolean) => patch({ flowSwitching });
  const setWorkflowCheckpointState = (workflowCheckpoint: ChatView["workflowCheckpoint"]) => patch({ workflowCheckpoint });
  const hasMessages = () => (useWorkspaceStore.getState().agentChats[chatId] || []).length > 0;

  const save = async () => {
    if (!rootPath) return;
    // Snapshot synchronously: closing the chat removes its messages from
    // the store, and a later render may belong to a different conversation.
    const messages = useWorkspaceStore.getState().agentChats[chatId] || [];
    const queue = state.chatSaveQueue;
    try {
      await queue.save(rootPath, chatId, messages, state.modifiedFiles, state.chatWorkflow, state.workflowCheckpoint, state.flowSwitching, state.historySummary, state.followedSpec);
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
    if (rootPath) refreshSummaryInBackground({ state, chatId, rootPath, save }, provider, model, compaction);
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

  /** The saved chat at `path` was deleted: if it is this chat, it is no longer saved. */
  const forget = (path: string) => {
    if (state.chatSaveQueue.path !== path) return;
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
    setAutoWorkflow, save, saved, savingTo, setModifiedFiles, setWorkflowCheckpoint, setChatWorkflow, adoptChatWorkflowPath, setFlowSwitching,
    refreshHistorySummary, restore, forget,
  };
}

export type ChatSessionActions = ReturnType<typeof chatSession>;

/** The chat's saved-conversation fields as shown, with what changes them. */
export function chatSessionView(view: ChatView, actions: ChatSessionActions) {
  const { activeChatPath, modifiedFiles, chatWorkflow, autoWorkflow, flowSwitching, workflowCheckpoint } = view;
  return { activeChatPath, modifiedFiles, chatWorkflow, autoWorkflow, flowSwitching, workflowCheckpoint, ...actions };
}

export type ChatSession = ReturnType<typeof chatSessionView>;
