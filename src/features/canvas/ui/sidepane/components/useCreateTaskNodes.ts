import React from "react";
import type { GeneratedContextDraft, GeneratedTaskDraft } from "../useExplorerWebSocket";
import type { GeneratedContextNodeSpec, GeneratedTaskNodeSpec } from "../../../../../store";

interface UseCreateTaskNodesParams {
  generatedTaskDraft: GeneratedTaskDraft[];
  generatedContextDraft: GeneratedContextDraft[];
  setGeneratedTaskDraft: React.Dispatch<React.SetStateAction<GeneratedTaskDraft[]>>;
  setGeneratedContextDraft: React.Dispatch<React.SetStateAction<GeneratedContextDraft[]>>;
  onCreateTaskNodes: (
    tasks: GeneratedTaskNodeSpec[],
    contexts: GeneratedContextNodeSpec[],
  ) => void | Promise<void>;
}

/** Turns the selected generated drafts into canvas nodes, guarding against double submits. */
export function useCreateTaskNodes({
  generatedTaskDraft,
  generatedContextDraft,
  setGeneratedTaskDraft,
  setGeneratedContextDraft,
  onCreateTaskNodes,
}: UseCreateTaskNodesParams) {
  const [isCreatingNodes, setIsCreatingNodes] = React.useState(false);
  const isCreatingNodesRef = React.useRef(false);

  const handleCreateTaskNodes = async () => {
    if (isCreatingNodesRef.current) return;

    const selectedTasks = generatedTaskDraft.filter((task) => task.selected && task.title.trim() && task.description.trim());
    const selectedKeys = new Set(selectedTasks.map((task) => task.key));
    const tasks = selectedTasks.map(({ key, title, description, dependsOn }) => ({
      key,
      title: title.trim(),
      description: description.trim(),
      dependsOn: dependsOn.filter((dependency) => selectedKeys.has(dependency)),
    }));
    const contexts = generatedContextDraft
      .filter((context) => context.selected && context.title.trim() && context.content.trim())
      .map(({ key, title, content, taskKeys }) => ({
        key,
        title: title.trim(),
        content: content.trim(),
        taskKeys: taskKeys.filter((taskKey) => selectedKeys.has(taskKey)),
      }))
      .filter((context) => context.taskKeys.length > 0);

    if (!tasks.length) return;

    isCreatingNodesRef.current = true;
    setIsCreatingNodes(true);
    try {
      await onCreateTaskNodes(tasks, contexts);
      setGeneratedTaskDraft([]);
      setGeneratedContextDraft([]);
    } finally {
      isCreatingNodesRef.current = false;
      setIsCreatingNodes(false);
    }
  };

  return { isCreatingNodes, handleCreateTaskNodes };
}
