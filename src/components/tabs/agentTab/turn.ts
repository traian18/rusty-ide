import type { Dispatch, SetStateAction } from "react";
import type { ContextCompactionRunConfig } from "../../../harness/core/decideToolConfig";
import type { FailedWorkflowCheckpoint } from "../../../harness/core/workflowRun";
import type { Todo } from "../../../harness/core/definitions/todoTool";
import type { RunHandle, WorkflowAnswer, WorkflowQuestion } from "../../../harness/contract";
import { notify } from "../../../notificationStore";
import { AgentChatResponseStream } from "../../../services/agentChatResponseStream";
import { AgentChatSaveQueue } from "../../../services/agentChatPersistence";
import type { QueuedSpecRun } from "../../../specs/launchStore";
import type { SpecRun } from "../../../specs/run";
import type { FollowedSpec } from "../../../services/agentChatPersistence";
import type { HistorySummary } from "../../../services/historySummary";
import type { AgentMessage, CustomProvider, useWorkspaceStore } from "../../../store";
import type { TabOfType } from "../../../tabs/types";
import type { StepPlan } from "../../agent/stepPlans";
import type { SubagentActivity } from "../../ui/Chat";
import type { AgentQuestion } from "../../ui/ChatInput";
import type { TokenUsageLike } from "../../ui/TokenBadge/TokenBadge";
import type { WorkflowChoice } from "../behaviors/AgentWorkflowBar";
import type { ActivityLog } from "./activityLog";
import type { GoalPass } from "./goalTurn";

export { DEFAULT_STREAMING_LABEL } from "./chats/chatStore";
import { DEFAULT_STREAMING_LABEL } from "./chats/chatStore";

/** What a chat keeps for its runs. Read by callbacks that outlive a render
 * (runs, saves), so it is one mutable object rather than state. */
export interface TurnState {
  /** The chat was closed: its runs' late events and outcomes are dropped. */
  disposed: boolean;
  agentRun: RunHandle<"agent_chat"> | null;
  /** The saved workflow (.rusty/workflows) this chat follows instead of a single agent loop. */
  chatWorkflow: string | undefined;
  workflowCheckpoint: FailedWorkflowCheckpoint | undefined;
  /** The workflows the picker offers, as of the latest render. */
  workflowOptions: WorkflowChoice[];
  /** Whether a running workflow may hand over to another at a step boundary. */
  flowSwitching: boolean;
  /** How the previous workflow run ended, which the Auto router sees. */
  lastWorkflowRun: { name: string; status: string } | undefined;
  /** Workflow whose run handle is currently active in this tab. */
  activeWorkflowId: string | null;
  activeWorkflowRunId: string | null;
  questionResolvers: Map<string, (answer: string) => void>;
  workflowAnswers: Map<string, (answer: WorkflowAnswer) => void>;
  /** Approval steps pass without asking, as of the latest render. */
  autoApprove: boolean;
  responseStream: AgentChatResponseStream | null;
  streamingResponseFlushTimeout: ReturnType<typeof setTimeout> | null;
  isStreaming: boolean;
  delegatedSubagentIds: Set<string>;
  activeWorkflowAgentStep: string | null;
  modifiedFiles: string[];
  chatSaveQueue: AgentChatSaveQueue;
  /** Smart compaction's running summary of this chat's earlier turns (saved with the chat). */
  historySummary: HistorySummary | undefined;
  /** The background summary pass in progress, if any. */
  historySummaryJob: AbortController | null;
  /** A Specify or Plan run set up from the Specs page; the next send starts it. */
  specRun: (SpecRun & { workflowPath: string }) | undefined;
  /** The change an Implement run of this chat works on (saved with the chat): a later message to the
   * same workflow, such as "continue" after a failure, still ticks its tasks in the change folder. */
  followedSpec: FollowedSpec | undefined;
  /** The latest workflow state the run reported, which has every finished step's output. */
  lastWorkflowState: unknown;
  /** Capability specs still to be written after the one that runs, each started when the previous completes. */
  specQueue: QueuedSpecRun[];
  /** The goal whose pass runs or is about to (see goalTurn.ts); a message from the user pauses it. */
  goal: GoalPass | undefined;
  /** The scheduled "continue" after a usage limit resets (see usageLimit.ts). */
  continueTimer: ReturnType<typeof setTimeout> | null;
}

export function createTurnState(): TurnState {
  return {
    disposed: false,
    agentRun: null,
    chatWorkflow: undefined,
    workflowCheckpoint: undefined,
    workflowOptions: [],
    flowSwitching: false,
    lastWorkflowRun: undefined,
    activeWorkflowId: null,
    activeWorkflowRunId: null,
    questionResolvers: new Map(),
    workflowAnswers: new Map(),
    autoApprove: false,
    responseStream: null,
    streamingResponseFlushTimeout: null,
    isStreaming: false,
    delegatedSubagentIds: new Set(),
    activeWorkflowAgentStep: null,
    modifiedFiles: [],
    chatSaveQueue: new AgentChatSaveQueue(),
    historySummary: undefined,
    historySummaryJob: null,
    specRun: undefined,
    followedSpec: undefined,
    lastWorkflowState: undefined,
    specQueue: [],
    goal: undefined,
    continueTimer: null,
  };
}

/** The chat's state setters a run drives. */
export interface TurnUi {
  setSubagents: Dispatch<SetStateAction<SubagentActivity[]>>;
  setAgentQuestions: Dispatch<SetStateAction<AgentQuestion[]>>;
  setWorkflowQuestions: Dispatch<SetStateAction<WorkflowQuestion[]>>;
  setRunUsage: (usage: TokenUsageLike | null) => void;
  setStreamingLabel: (label: string) => void;
  setIsStreaming: (streaming: boolean) => void;
  setAutoWorkflow: (path: string | undefined) => void;
  setWorkflowRunning: (running: boolean) => void;
  setPlan: (todos: Todo[]) => void;
  setStepPlans: Dispatch<SetStateAction<StepPlan[]>>;
  setMessage: (message: string) => void;
  setContinueAt: (at: string | undefined) => void;
}

/** The chat-level operations a run calls. */
export interface TurnChat {
  setModifiedFiles(files: string[]): void;
  setWorkflowCheckpoint(value: unknown): void;
  setChatWorkflow(path: string | undefined): void;
  /** Follows the same workflow by another path (the built-in one by its own), keeping the run state. */
  adoptChatWorkflowPath(path: string): void;
  clearWorkflowQuestions(): void;
  save(): Promise<void>;
  refreshHistorySummary(provider: CustomProvider, model: string, compaction: ContextCompactionRunConfig): void;
  openChangedFile(path: string): void;
}

/** Everything one message's runs work with, taken when the message is sent.
 * It belongs to one chat, so the runs keep writing to it while another is shown. */
export interface AgentTurn {
  tab: TabOfType<"agent">;
  /** The chat the runs belong to: what messages, todos, command grants and the harness session are keyed by. */
  chatId: string;
  rootPath: string;
  selectedModel: string;
  selectedSkillId: string;
  intelligentModelSelectionSettings: ReturnType<typeof useWorkspaceStore.getState>["intelligentModelSelectionSettings"];
  state: TurnState;
  activity: ActivityLog;
  ui: TurnUi;
  chat: TurnChat;
  addMessage(message: AgentMessage): void;
  updateMessage(id: string, content: string): void;
}

/** A response stream whose progress lines go to the activity log through `progress`. */
export function startResponseStream(turn: AgentTurn, progress: (content: string) => void): AgentChatResponseStream {
  const stream = new AgentChatResponseStream(
    (message) => turn.addMessage(message),
    (id, content) => turn.updateMessage(id, content),
    progress,
  );
  turn.state.responseStream = stream;
  return stream;
}

export function scheduleResponseFlush(state: TurnState) {
  if (state.streamingResponseFlushTimeout) return;
  state.streamingResponseFlushTimeout = setTimeout(() => {
    state.streamingResponseFlushTimeout = null;
    state.responseStream?.flush();
  }, 100);
}

export function cancelResponseFlush(state: TurnState) {
  if (state.streamingResponseFlushTimeout) clearTimeout(state.streamingResponseFlushTimeout);
  state.streamingResponseFlushTimeout = null;
}

let lastMessageTime = 0;

/** A chat message id, `msg_<time>`: never the same twice, even for messages added in the same
 * millisecond (a goal's status line and the pass it starts), since the chat keys its rows by it
 * and a repeated key leaves a stale row on screen. */
export function nextMessageId(): string {
  lastMessageTime = Math.max(Date.now(), lastMessageTime + 1);
  return `msg_${lastMessageTime}`;
}

export function addAssistantMessage(turn: AgentTurn, content: string) {
  turn.addMessage({ id: nextMessageId(), role: "assistant", content, timestamp: new Date().toISOString() });
}

/** Ends the turn before any run started: says why in the chat and in a notification. */
export function abandonTurn(turn: AgentTurn, chatMessage: string, title: string, notice: string) {
  addAssistantMessage(turn, chatMessage);
  turn.state.isStreaming = false;
  turn.ui.setIsStreaming(false);
  notify(title, notice, "error");
}

/** Clears what a turn leaves behind once its last run ended, however it ended. */
export function endTurn(turn: AgentTurn) {
  turn.state.isStreaming = false;
  turn.state.responseStream = null;
  turn.state.agentRun = null;
  turn.state.activeWorkflowId = null;
  turn.ui.setIsStreaming(false);
  turn.ui.setStreamingLabel(DEFAULT_STREAMING_LABEL);
  turn.ui.setAgentQuestions([]);
  turn.chat.clearWorkflowQuestions();
  turn.state.questionResolvers.clear();
}

/** Releases everything still waiting on an answer (a run's question, Auto's choice) as declined. */
export function releasePendingQuestions(state: TurnState) {
  for (const resolve of state.questionResolvers.values()) resolve("");
  state.questionResolvers.clear();
}
