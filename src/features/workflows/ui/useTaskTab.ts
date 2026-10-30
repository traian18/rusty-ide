import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useWorkspaceStore } from "../../../store";
import { workflowClient } from "../client";
import { VfsRegistry } from "../../canvas";
import { getFileTypeDetails } from "../../editor/ui";
import { useDiffViewMode } from "../../../lib/ui/useDiffViewMode";
import { useSelectableModels } from "../../providers/ui";
import type { TabOfType } from "../../../app/tabs/types";

export const EMPTY_ARRAY: any[] = [];

export interface TaskTabProps {
  tab: TabOfType<"task">;
  onExecuteNode: (
    nodeId: string,
    customPrompt?: string,
    attachments?: { path: string; name: string; isDir?: boolean }[]
  ) => void;
  onStopExecution: (nodeId: string) => void;
  isActive: boolean;
}

export function useTaskTab(props: Pick<TaskTabProps, "tab" | "isActive">) {
  const { tab, isActive } = props;
  const nodes = useWorkspaceStore((state) => state.nodes);
  const customProviders = useWorkspaceStore((state) => state.customProviders);
  const activeCustomProviderId = useWorkspaceStore((state) => state.activeCustomProviderId);
  const providerStatus = useWorkspaceStore((state) => state.providerStatus);
  const activeModel = useWorkspaceStore((state) => state.activeModel);
  const updateTaskNode = useWorkspaceStore((state) => state.updateTaskNode);
  const { options: modelOptions, unauthenticatedProviders } = useSelectableModels(
    customProviders,
    providerStatus,
    activeCustomProviderId,
  );
  const editorFontSize = useWorkspaceStore((state) => state.typographyPreferences.editorFontSize);
  // Declared before the selectors that close over it: the previous ordering
  // read taskNodeId from its temporal dead zone, which only ever avoided
  // throwing because nothing currently opens a task tab.
  const taskNodeId = tab.taskNodeId;
  const chatHistory = useWorkspaceStore((state) => state.globalChatHistory[taskNodeId] || EMPTY_ARRAY);

  const taskNode = nodes.find((n) => n.id === taskNodeId);
  const rawNodeLogs = useWorkspaceStore((state) => state.nodeLogs[taskNodeId]);
  const nodeLogs = rawNodeLogs || EMPTY_ARRAY;
  const nodeStatus = useWorkspaceStore((state) => state.nodeStatus[taskNodeId] || "idle");

  const canvasTabId = useMemo(() => {
    const contexts = useWorkspaceStore.getState().canvasContexts;
    for (const tId in contexts) {
      if (contexts[tId].nodes.some((n) => n.id === taskNodeId)) {
        return tId;
      }
    }
    return undefined;
  }, [taskNodeId]);

  const [taskSubTab, setTaskSubTab] = useState<"diff" | "chat" | "console">("chat");
  const [chatMessage, setChatMessage] = useState("");
  const [originalCode, setOriginalCode] = useState("// Loading original content...");
  const [modifiedCode, setModifiedCode] = useState("// Loading modified content...");
  const [loadingDiff, setLoadingDiff] = useState(false);
  const [editedCode, setEditedCode] = useState<string>("");
  const [isDirty, setIsDirty] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const modifiedFiles = (taskNode?.data?.modifiedFiles as string[]) || EMPTY_ARRAY;
  const originalFileContents = (taskNode?.data?.originalFileContents as Record<string, string>) || {};
  const generatedFileContents = (taskNode?.data?.generatedFileContents as Record<string, string>) || {};
  const [activeDiffFile, setActiveDiffFile] = useState<string>("");

  const diffEditorRef = useRef<any>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const { viewMode, isAutoMode, toggleViewMode, enableAutoMode, renderSideBySide } = useDiffViewMode(containerRef);

  // Set active diff file automatically if modified files exist
  useEffect(() => {
    if (modifiedFiles.length > 0) {
      if (!modifiedFiles.includes(activeDiffFile)) {
        setActiveDiffFile(modifiedFiles[0]);
      }
    } else {
      setActiveDiffFile("");
    }
  }, [modifiedFiles, activeDiffFile]);

  // Load file content diffs
  useEffect(() => {
    if (!activeDiffFile) return;

    const fetchDiffContent = async () => {
      setLoadingDiff(true);
      try {
        const modified: string = generatedFileContents[activeDiffFile] !== undefined
          ? generatedFileContents[activeDiffFile]
          : await VfsRegistry.getOrCreate(canvasTabId).readFile(activeDiffFile);
        
        let original = originalFileContents[activeDiffFile];
        if (original === undefined) {
          try {
            original = await workflowClient.readFile(activeDiffFile);
          } catch (e) {
            original = "";
          }
        }

        setOriginalCode(original);
        setModifiedCode(modified);
      } catch (err: any) {
        console.error("TaskTab failed to load diff:", err);
        setOriginalCode(`// Error reading file: ${err.message}`);
        setModifiedCode(`// Error reading file: ${err.message}`);
      } finally {
        setLoadingDiff(false);
      }
    };

    fetchDiffContent();
  }, [
    activeDiffFile,
    nodeStatus,
    canvasTabId,
    originalFileContents[activeDiffFile],
    generatedFileContents[activeDiffFile],
  ]);

  // Adjust editor size when active state changes
  useEffect(() => {
    if (isActive && diffEditorRef.current && taskSubTab === "diff") {
      setTimeout(() => {
        if (diffEditorRef.current) {
          diffEditorRef.current.layout();
        }
      }, 50);
    }
  }, [isActive, taskSubTab]);

  const handleEditorMount = useCallback((editor: any) => {
    diffEditorRef.current = editor;
    const modifiedEditor = editor.getModifiedEditor();
    modifiedEditor.updateOptions({ readOnly: false });
    modifiedEditor.onDidChangeModelContent(() => {
      const newContent = modifiedEditor.getValue();
      setEditedCode(newContent);
      setIsDirty(newContent !== modifiedCode);
    });
    setTimeout(() => {
      editor.layout();
    }, 50);
  }, [modifiedCode]);

  const handleSave = async () => {
    if (!activeDiffFile || !isDirty) return;
    setIsSaving(true);
    try {
      await VfsRegistry.getOrCreate(canvasTabId).writeFile(activeDiffFile, editedCode, taskNodeId);
      updateTaskNode(taskNodeId, {
        originalFileContents: {
          ...originalFileContents,
          [activeDiffFile]: originalFileContents[activeDiffFile] ?? originalCode,
        },
        generatedFileContents: {
          ...generatedFileContents,
          [activeDiffFile]: editedCode,
        },
      });
      setIsDirty(false);
      if (canvasTabId) {
        const { canvasFileService } = await import("../../canvas/ui");
        await canvasFileService.autoSaveCanvas(canvasTabId);
      }
    } catch (err) {
      console.error("Failed to save file:", err);
    } finally {
      setIsSaving(false);
    }
  };

  const handleReset = () => {
    if (diffEditorRef.current) {
      const modifiedEditor = diffEditorRef.current.getModifiedEditor();
      modifiedEditor.setValue(modifiedCode);
      setEditedCode(modifiedCode);
      setIsDirty(false);
    }
  };

  const getEditorLanguage = (filePath: string): string => {
    return getFileTypeDetails(filePath).language;
  };

  const displayCode = isDirty ? editedCode : modifiedCode;

  return {
    modelOptions,
    nodes,
    customProviders,
    activeCustomProviderId,
    providerStatus,
    activeModel,
    updateTaskNode,
    options: modelOptions,
    unauthenticatedProviders,
    editorFontSize,
    taskNodeId,
    chatHistory,
    taskNode,
    rawNodeLogs,
    nodeLogs,
    nodeStatus,
    canvasTabId,
    taskSubTab,
    setTaskSubTab,
    chatMessage,
    setChatMessage,
    originalCode,
    setOriginalCode,
    modifiedCode,
    setModifiedCode,
    loadingDiff,
    setLoadingDiff,
    editedCode,
    setEditedCode,
    isDirty,
    setIsDirty,
    isSaving,
    setIsSaving,
    modifiedFiles,
    originalFileContents,
    generatedFileContents,
    activeDiffFile,
    setActiveDiffFile,
    diffEditorRef,
    containerRef,
    viewMode,
    isAutoMode,
    toggleViewMode,
    enableAutoMode,
    renderSideBySide,
    handleEditorMount,
    handleSave,
    handleReset,
    getEditorLanguage,
    displayCode,
  };
}
