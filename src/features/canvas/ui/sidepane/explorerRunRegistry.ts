import type { SubagentActivity } from "../../../agent-chat/ui";
import type { RunHandle } from "../../../../harness/contract";

export interface GeneratedTaskDraft {
  key: string;
  title: string;
  description: string;
  dependsOn: string[];
  selected: boolean;
}

export interface GeneratedContextDraft {
  key: string;
  title: string;
  content: string;
  taskKeys: string[];
  selected: boolean;
}

export interface TaskGenerationFailure {
  code?: string;
  message: string;
  attempts?: number;
}

export const activeExplorerChatRuns = new Map<string, RunHandle<"agent_chat">>();
/** Mirrors activeExplorerChatRuns's module-level, per-node scoping: at most
 * one pending agent_question per node (agentQuestion state below is a
 * single slot, not a queue, matching the sidecar's own one-question-at-a-
 * time agent_chat behavior). */
export const explorerQuestionResolvers = new Map<string, (answer: string) => void>();
export const activeExplorerSubagents = new Map<string, SubagentActivity[]>();

export interface ActiveTaskGeneration {
  run: RunHandle<"generate_task_nodes">;
  requestId: string;
}

export interface TaskGenerationViewState {
  promptOpen: boolean;
  instructions: string;
  failure: TaskGenerationFailure | null;
  draft: GeneratedTaskDraft[];
  contextDraft: GeneratedContextDraft[];
}

export const TASK_GENERATION_CHANGED_EVENT = "rusty-task-generation-changed";
export const activeTaskGenerations = new Map<string, ActiveTaskGeneration>();
export const taskGenerationViewStates = new Map<string, TaskGenerationViewState>();

export const getTaskGenerationViewState = (nodeId: string): TaskGenerationViewState =>
  taskGenerationViewStates.get(nodeId) || {
    promptOpen: false,
    instructions: "",
    failure: null,
    draft: [],
    contextDraft: [],
  };

export const publishTaskGenerationChange = (nodeId: string) => {
  window.dispatchEvent(new CustomEvent(TASK_GENERATION_CHANGED_EVENT, { detail: { nodeId } }));
};

export const updateTaskGenerationViewState = (nodeId: string, updates: Partial<TaskGenerationViewState>) => {
  taskGenerationViewStates.set(nodeId, { ...getTaskGenerationViewState(nodeId), ...updates });
  publishTaskGenerationChange(nodeId);
};

export const setActiveTaskGeneration = (nodeId: string, generation: ActiveTaskGeneration | null) => {
  if (generation) activeTaskGenerations.set(nodeId, generation);
  else activeTaskGenerations.delete(nodeId);
  publishTaskGenerationChange(nodeId);
};

export const finishTaskGeneration = (
  nodeId: string,
  run: RunHandle<"generate_task_nodes">,
  updates: Partial<TaskGenerationViewState> = {},
) => {
  const active = activeTaskGenerations.get(nodeId);
  if (active?.run === run) activeTaskGenerations.delete(nodeId);
  taskGenerationViewStates.set(nodeId, { ...getTaskGenerationViewState(nodeId), ...updates });
  publishTaskGenerationChange(nodeId);
};

export type IncomingSubagent = SubagentActivity & { previousId?: string; appendLog?: string };

export const mergeSubagentUpdate = (nodeId: string, incoming: IncomingSubagent): SubagentActivity[] => {
  const current = activeExplorerSubagents.get(nodeId) || [];
  const index = current.findIndex((agent) =>
    agent.id === incoming.id || (!!incoming.previousId && agent.id === incoming.previousId)
  );
  const incomingLogs = [...(incoming.logs || []), ...(incoming.appendLog ? [incoming.appendLog] : [])];
  const cleanIncoming = { ...incoming };
  delete cleanIncoming.previousId;
  delete cleanIncoming.appendLog;

  let next: SubagentActivity[];
  if (index < 0) {
    next = [...current, { ...cleanIncoming, logs: incomingLogs }];
  } else {
    next = [...current];
    const mergedLogs = [...(next[index].logs || [])];
    for (const line of incomingLogs) {
      if (line && mergedLogs[mergedLogs.length - 1] !== line) mergedLogs.push(line);
    }
    next[index] = { ...next[index], ...cleanIncoming, logs: mergedLogs.slice(-4) };
  }
  activeExplorerSubagents.set(nodeId, next);
  return next;
};
