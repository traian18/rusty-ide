import { useState, useEffect, useRef } from "react";
import { useWorkspaceStore } from "../../../../store";
import { notify } from "../../../notifications";
import { resolveExecutionProvider } from "../../../providers";
import { harness } from "../../../../harness";
import { createRunHost } from "../../../../harness/hostDefaults";
import type { RunHandle } from "../../../../harness/contract";
import {
  TASK_GENERATION_CHANGED_EVENT,
  activeTaskGenerations,
  finishTaskGeneration,
  getTaskGenerationViewState,
  setActiveTaskGeneration,
  taskGenerationViewStates,
  updateTaskGenerationViewState,
  type GeneratedContextDraft,
  type GeneratedTaskDraft,
  type TaskGenerationFailure,
} from "./explorerRunRegistry";

interface TaskGenerationParams {
  selectedNodeId: string | null;
  selectedNode: any;
  nodeStatus: string;
  tabId: string | undefined;
  taskGenerationModel: string;
}

/** Task-node generation for the selected explorer node; runs outlive the pane (see explorerRunRegistry). */
export function useTaskGeneration({ selectedNodeId, selectedNode, nodeStatus, tabId, taskGenerationModel }: TaskGenerationParams) {
  const [isGeneratingTasks, setIsGeneratingTasks] = useState(false);
  const [isTaskGenerationPromptOpen, setIsTaskGenerationPromptOpen] = useState(false);
  const [taskGenerationInstructions, setTaskGenerationInstructions] = useState("");
  const [taskGenerationFailure, setTaskGenerationFailure] = useState<TaskGenerationFailure | null>(null);
  const [generatedTaskDraft, setGeneratedTaskDraft] = useState<GeneratedTaskDraft[]>([]);
  const [generatedContextDraft, setGeneratedContextDraft] = useState<GeneratedContextDraft[]>([]);
  const taskGenerationRunRef = useRef<RunHandle<"generate_task_nodes"> | null>(null);
  const taskGenerationRequestIdRef = useRef<string | null>(null);
  const addLog = useWorkspaceStore((state) => state.addLog);

  useEffect(() => {
    const syncTaskGeneration = () => {
      if (!selectedNodeId) {
        taskGenerationRunRef.current = null;
        taskGenerationRequestIdRef.current = null;
        setIsGeneratingTasks(false);
        setIsTaskGenerationPromptOpen(false);
        setTaskGenerationInstructions("");
        setTaskGenerationFailure(null);
        setGeneratedTaskDraft([]);
        setGeneratedContextDraft([]);
        return;
      }

      const active = activeTaskGenerations.get(selectedNodeId);
      const isActive = !!active;
      taskGenerationRunRef.current = isActive ? active!.run : null;
      taskGenerationRequestIdRef.current = isActive ? active!.requestId : null;
      setIsGeneratingTasks(isActive);

      const viewState = getTaskGenerationViewState(selectedNodeId);
      setIsTaskGenerationPromptOpen(viewState.promptOpen);
      setTaskGenerationInstructions(viewState.instructions);
      setTaskGenerationFailure(viewState.failure);
      setGeneratedTaskDraft(viewState.draft);
      setGeneratedContextDraft(viewState.contextDraft);
    };

    const handleTaskGenerationChanged = (event: Event) => {
      const detail = (event as CustomEvent<{ nodeId: string }>).detail;
      if (detail?.nodeId === selectedNodeId) syncTaskGeneration();
    };

    syncTaskGeneration();
    window.addEventListener(TASK_GENERATION_CHANGED_EVENT, handleTaskGenerationChanged);
    return () => window.removeEventListener(TASK_GENERATION_CHANGED_EVENT, handleTaskGenerationChanged);
  }, [selectedNodeId]);

  const handleOpenTaskGeneration = () => {
    if (!selectedNodeId || isGeneratingTasks || activeTaskGenerations.has(selectedNodeId) || nodeStatus === "running") return;
    const history = useWorkspaceStore.getState().globalChatHistory[selectedNodeId] || [];
    if (!history.some((message) => message.role === "user" || message.role === "assistant")) {
      notify("Generate Tasks", "Discuss the story before generating task nodes.", "info");
      return;
    }
    updateTaskGenerationViewState(selectedNodeId, { failure: null, promptOpen: true });
  };

  const handleGenerateTaskDraft = () => {
    if (!selectedNodeId || isGeneratingTasks || nodeStatus === "running") return;
    const taskNodeId = selectedNodeId;
    if (activeTaskGenerations.has(taskNodeId)) return;
    const history = useWorkspaceStore.getState().globalChatHistory[taskNodeId] || [];
    const chatHistory = history
      .filter((message) => message.role === "user" || message.role === "assistant")
      .map((message) => ({ role: message.role, content: message.content }));
    if (!chatHistory.length) {
      notify("Generate Tasks", "Discuss the story before generating task nodes.", "info");
      return;
    }

    const additionalInstructions = getTaskGenerationViewState(taskNodeId).instructions.trim();
    const requestId = `tasks_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const state = useWorkspaceStore.getState();
    const resolution = resolveExecutionProvider(
      state.customProviders,
      state.providerStatus,
      state.activeCustomProviderId,
      taskGenerationModel,
    );
    if (!resolution.ok) {
      updateTaskGenerationViewState(taskNodeId, {
        failure: { message: resolution.message },
        promptOpen: true,
      });
      notify("Cannot generate tasks", resolution.message, "error");
      return;
    }

    taskGenerationViewStates.set(taskNodeId, {
      ...getTaskGenerationViewState(taskNodeId),
      promptOpen: false,
      failure: null,
      draft: [],
      contextDraft: [],
    });

    const run = harness.run(
      "generate_task_nodes",
      {
        nodeId: taskNodeId,
        requestId,
        model: taskGenerationModel,
        chatHistory,
        additionalInstructions,
        workspaceRoot: state.rootPath,
        customProvider: resolution.provider,
      },
      createRunHost(),
      (event) => {
        if (event.kind === "log") addLog(taskNodeId, event.message);
      },
      {
        surface: "canvas-node",
        tabId,
        canvasId: tabId,
        nodeId: taskNodeId,
        displayLabel: `Generate tasks · ${String((selectedNode?.data as any)?.name || taskNodeId)}`,
      },
    );
    void run.done.then((outcome) => {
      if (outcome.status === "completed") {
        const { tasks, contexts } = outcome.result;
        const draft = tasks.map((task: any, index: number) => ({
          key: String(task.key || `task-${index + 1}`),
          title: String(task.title || ""),
          description: String(task.description || ""),
          dependsOn: Array.isArray(task.dependsOn) ? task.dependsOn.map(String) : [],
          selected: true,
        }));
        const contextDraft = contexts.map((context: any, index: number) => ({
          key: String(context.key || `context-${index + 1}`),
          title: String(context.title || `Code context ${index + 1}`),
          content: String(context.content || ""),
          taskKeys: Array.isArray(context.taskKeys) ? context.taskKeys.map(String) : [],
          selected: true,
        }));
        finishTaskGeneration(taskNodeId, run, {
          draft,
          contextDraft,
          instructions: "",
          failure: null,
          promptOpen: false,
        });
      } else if (outcome.status === "cancelled") {
        finishTaskGeneration(taskNodeId, run);
      } else {
        const failure: TaskGenerationFailure = {
          code: outcome.error.code,
          message: outcome.error.message,
          attempts: typeof outcome.error.details?.attempts === "number" ? outcome.error.details.attempts : undefined,
        };
        finishTaskGeneration(taskNodeId, run, { failure, promptOpen: true });
        if (failure.code === "INVALID_TASK_JSON") {
          notify(
            "Switch Task Generation Model",
            "Task generation returned invalid JSON twice. The selected model may be too small to complete this task reliably. Choose a more capable model in the task-generation panel, then retry.",
            "error"
          );
        } else {
          notify("Task Generation Failed", failure.message, "error");
        }
      }
    });
    setActiveTaskGeneration(taskNodeId, { run, requestId });
    taskGenerationRunRef.current = run;
    taskGenerationRequestIdRef.current = requestId;
  };

  const handleStopTaskGeneration = () => {
    if (!selectedNodeId) return;
    const active = activeTaskGenerations.get(selectedNodeId);
    const run = active?.run || taskGenerationRunRef.current;
    run?.cancel();
    if (run) finishTaskGeneration(selectedNodeId, run);
    taskGenerationRunRef.current = null;
    taskGenerationRequestIdRef.current = null;
  };

  const updateGeneratedTaskDraft: typeof setGeneratedTaskDraft = (action) => {
    if (!selectedNodeId) return;
    const current = getTaskGenerationViewState(selectedNodeId).draft;
    const draft = typeof action === "function" ? action(current) : action;
    updateTaskGenerationViewState(selectedNodeId, { draft });
  };

  const updateGeneratedContextDraft: typeof setGeneratedContextDraft = (action) => {
    if (!selectedNodeId) return;
    const current = getTaskGenerationViewState(selectedNodeId).contextDraft;
    const contextDraft = typeof action === "function" ? action(current) : action;
    updateTaskGenerationViewState(selectedNodeId, { contextDraft });
  };

  const updateTaskGenerationPromptOpen = (promptOpen: boolean) => {
    if (selectedNodeId) updateTaskGenerationViewState(selectedNodeId, { promptOpen });
  };

  const updateTaskGenerationInstructions = (instructions: string) => {
    if (selectedNodeId) updateTaskGenerationViewState(selectedNodeId, { instructions });
  };

  return {
    isGeneratingTasks,
    generatedTaskDraft,
    setGeneratedTaskDraft: updateGeneratedTaskDraft,
    generatedContextDraft,
    setGeneratedContextDraft: updateGeneratedContextDraft,
    isTaskGenerationPromptOpen,
    setIsTaskGenerationPromptOpen: updateTaskGenerationPromptOpen,
    taskGenerationInstructions,
    setTaskGenerationInstructions: updateTaskGenerationInstructions,
    taskGenerationFailure,
    handleOpenTaskGeneration,
    handleGenerateTaskDraft,
    handleStopTaskGeneration,
  };
}
