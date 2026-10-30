import React from "react";
import { DiffEditor } from "@monaco-editor/react";
import { Terminal, MessageSquare, Code, Save, RotateCcw, Trash2 } from "lucide-react";
import { CustomSelect } from "../../../lib/ui/CustomSelect";
import { VfsRegistry } from "../../canvas";
import { DiffViewToggle } from "../../../lib/ui/DiffViewToggle";
import { Chat } from "../../agent-chat/ui";
import { ChatInput } from "../../agent-chat/ui";
import { createMonacoDiffOptions } from "../../editor";
import { useTaskTab, type TaskTabProps } from "./useTaskTab";
import { TaskFooter } from "./TaskFooter";

export const TaskTab: React.FC<TaskTabProps> = (props) => {
  const model = useTaskTab(props);
  const { onExecuteNode, onStopExecution } = props;
  const { modelOptions, activeModel, updateTaskNode, unauthenticatedProviders, editorFontSize, taskNodeId, chatHistory, taskNode, nodeLogs, nodeStatus, canvasTabId, taskSubTab, setTaskSubTab, chatMessage, setChatMessage, originalCode, loadingDiff, isDirty, isSaving, modifiedFiles, originalFileContents, generatedFileContents, activeDiffFile, setActiveDiffFile, containerRef, viewMode, isAutoMode, toggleViewMode, enableAutoMode, renderSideBySide, handleEditorMount, handleSave, handleReset, getEditorLanguage, displayCode } = model;
  if (!taskNode) {
    return (
      <div className="w-full h-full flex items-center justify-center font-mono text-xs text-[var(--text-muted)] bg-[var(--bg-app)]">
        <span>Task Node not found.</span>
      </div>
    );
  }


  return (
    <div className="w-full h-full bg-[var(--bg-app)] flex flex-col text-[var(--text-normal)] font-sans relative">
      <div className="flex-1 flex flex-col overflow-hidden relative">
        {/* Task Sub Tabs Row */}
        <div className="flex border-b border-[var(--border-color)] bg-[var(--bg-sidebar)]/50 text-xs font-mono justify-between items-center pr-3 select-none flex-shrink-0">
          <div className="flex">
            <button
              onClick={() => setTaskSubTab("diff")}
              className={`flex items-center space-x-1.5 px-4 py-2 border-b-2 transition-all ${
                taskSubTab === "diff"
                  ? "border-[var(--accent-color)] text-[var(--text-light)] bg-[var(--accent-bg)] font-semibold"
                  : "border-transparent text-[var(--text-muted)] hover:text-[var(--text-light)]"
              }`}
            >
              <Code size={14} />
              <span>VFS Diff</span>
            </button>
            <button
              onClick={() => setTaskSubTab("chat")}
              className={`flex items-center space-x-1.5 px-4 py-2 border-b-2 transition-all ${
                taskSubTab === "chat"
                  ? "border-[var(--accent-color)] text-[var(--text-light)] bg-[var(--accent-bg)] font-semibold"
                  : "border-transparent text-[var(--text-muted)] hover:text-[var(--text-light)]"
              }`}
            >
              <MessageSquare size={14} />
              <span>Prompt Chat</span>
            </button>
            <button
              onClick={() => setTaskSubTab("console")}
              className={`flex items-center space-x-1.5 px-4 py-2 border-b-2 transition-all relative ${
                taskSubTab === "console"
                  ? "border-[var(--accent-color)] text-[var(--text-light)] bg-[var(--accent-bg)] font-semibold"
                  : "border-transparent text-[var(--text-muted)] hover:text-[var(--text-light)]"
              }`}
            >
              <Terminal size={14} />
              <span>Console Stream</span>
              {nodeStatus === "running" && (
                <span className="absolute top-2.5 right-2 w-1.5 h-1.5 rounded-full bg-[var(--accent-color)] animate-ping" />
              )}
            </button>
          </div>

          {/* Model Selector Dropdown */}
          <div className="flex items-center space-x-2 py-1">
            <span className="text-[10px] text-[var(--text-muted)] font-sans uppercase font-semibold">Model:</span>
            <CustomSelect
              value={(taskNode.data as any).model || activeModel}
              onChange={(val) => updateTaskNode(taskNodeId, { model: val })}
              options={modelOptions}
              placeholder={modelOptions.length === 0 && unauthenticatedProviders.length > 0
                ? `Sign in to ${unauthenticatedProviders.map((p) => p.name).join(", ")}`
                : "No models configured"}
              className="w-48"
            />
          </div>
        </div>

        {/* Task Diff Selector Dropdown */}
        {taskSubTab === "diff" && modifiedFiles.length > 0 && (
          <div className="px-4 py-2 border-b border-[var(--border-color)] bg-[var(--bg-sidebar)] flex items-center justify-between text-xs font-mono">
            <div className="flex items-center space-x-3">
              <span className="text-[var(--text-muted)] mr-4">File Diff:</span>
              <CustomSelect
                value={activeDiffFile}
                onChange={setActiveDiffFile}
                options={modifiedFiles.map((file) => ({
                  id: file,
                  name: file.split("/").pop() || file,
                }))}
                className="w-64"
              />
              {activeDiffFile && (
                <button
                  onClick={async () => {
                    if (confirm(`Are you sure you want to delete ${activeDiffFile.split("/").pop() || activeDiffFile} from this task's VFS?`)) {
                      try {
                        await VfsRegistry.getOrCreate(canvasTabId).deleteNodeFile(taskNodeId, activeDiffFile);
                        const newFiles = modifiedFiles.filter((f) => f !== activeDiffFile);
                        const nextOriginalFileContents = { ...originalFileContents };
                        const nextGeneratedFileContents = { ...generatedFileContents };
                        delete nextOriginalFileContents[activeDiffFile];
                        delete nextGeneratedFileContents[activeDiffFile];
                        updateTaskNode(taskNodeId, {
                          modifiedFiles: newFiles,
                          originalFileContents: nextOriginalFileContents,
                          generatedFileContents: nextGeneratedFileContents,
                        });
                        if (canvasTabId) {
                          const { canvasFileService } = await import("../../canvas/ui");
                          await canvasFileService.autoSaveCanvas(canvasTabId);
                        }
                      } catch (err) {
                        console.error("Failed to delete VFS file:", err);
                      }
                    }
                  }}
                  className="p-1 text-[var(--text-muted)] hover:text-[var(--color-status-danger)] hover:bg-[var(--color-status-danger-bg)] rounded transition-colors cursor-pointer"
                  title="Delete this file from VFS"
                >
                  <Trash2 size={14} />
                </button>
              )}
              <button
                onClick={async () => {
                  if (confirm("Are you sure you want to delete all files modified by this task node from the VFS?")) {
                    try {
                      await VfsRegistry.getOrCreate(canvasTabId).deleteNodeFiles(taskNodeId);
                      updateTaskNode(taskNodeId, {
                        modifiedFiles: [],
                        originalFileContents: {},
                        generatedFileContents: {},
                      });
                      if (canvasTabId) {
                        const { canvasFileService } = await import("../../canvas/ui");
                        await canvasFileService.autoSaveCanvas(canvasTabId);
                      }
                    } catch (err) {
                      console.error("Failed to delete all VFS files:", err);
                    }
                  }
                }}
                className="flex items-center space-x-1 px-1.5 py-0.5 text-[10px] text-[var(--text-muted)] hover:text-[var(--color-status-danger)] hover:bg-[var(--color-status-danger-bg)] rounded transition-colors cursor-pointer animate-fade-in"
                title="Delete all files from VFS"
              >
                <Trash2 size={12} />
                <span>Delete All</span>
              </button>
            </div>
            <DiffViewToggle
              viewMode={viewMode}
              isAutoMode={isAutoMode}
              onToggle={toggleViewMode}
              onEnableAuto={enableAutoMode}
            />
          </div>
        )}

        {/* Edit Controls */}
        {taskSubTab === "diff" && activeDiffFile && (
          <div className="px-4 py-2 border-b border-[var(--border-color)] bg-[var(--bg-sidebar)]/50 flex items-center justify-end space-x-2 text-xs font-mono">
            <span className="text-[10px] text-[var(--text-muted)] font-mono mr-auto">
              {isDirty ? "Modified (unsaved)" : "Editable"}
            </span>
            <button
              onClick={handleReset}
              disabled={!isDirty || isSaving}
              className="flex items-center space-x-1 px-2 py-1 text-[10px] font-mono text-[var(--text-muted)] hover:text-[var(--text-light)] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              title="Reset changes"
            >
              <RotateCcw size={11} />
              <span>Reset</span>
            </button>
            <button
              onClick={handleSave}
              disabled={!isDirty || isSaving}
              className="flex items-center space-x-1 px-2 py-1 text-[10px] font-mono bg-[var(--color-status-success-bg)] hover:bg-[var(--color-status-success-solid)] text-[var(--color-status-success)] hover:text-[var(--color-status-success-solid-foreground)] disabled:bg-[var(--bg-sidebar)] disabled:text-[var(--text-muted)] rounded transition-colors"
              title="Save changes to VFS"
            >
              <Save size={11} />
              <span>{isSaving ? "Saving..." : "Save"}</span>
            </button>
          </div>
        )}

        {/* Task Sub Tab Content */}
        <div className="flex-1 overflow-hidden relative bg-[var(--bg-app)]">
          {taskSubTab === "diff" && (
            activeDiffFile ? (
              <div ref={containerRef} className="w-full h-full relative bg-[var(--bg-app)]">
                {loadingDiff ? (
                  <div className="w-full h-full flex items-center justify-center font-mono text-xs text-[var(--text-muted)]">
                    <span>Loading diff view...</span>
                  </div>
                ) : (
                  <DiffEditor
                    height="100%"
                    language={getEditorLanguage(activeDiffFile)}
                    theme="rusty-custom-theme"
                    original={originalCode}
                    modified={displayCode}
                    onMount={handleEditorMount}
                    options={createMonacoDiffOptions(editorFontSize, {
                      readOnly: false,
                      minimap: { enabled: false },
                      scrollBeyondLastLine: false,
                      lineNumbers: "on",
                      renderSideBySide,
                    })}
                  />
                )}
              </div>
            ) : (
              <div className="w-full h-full flex flex-col items-center justify-center p-8 text-center text-[var(--text-muted)] font-mono text-xs space-y-2 select-none">
                <span className="text-[var(--accent-color)] font-bold">// Sandbox VFS Standby</span>
                <span className="text-[11px] text-[var(--text-muted)] max-w-[280px]">
                  No files modified by this task node yet. Connect a source File Node, type prompt instructions, and click "Run Executor".
                </span>
              </div>
            )
          )}

          {taskSubTab === "console" && (
            <div className="flex flex-col h-full p-4 font-mono text-xs bg-[var(--color-log-background)] text-[var(--color-log-foreground)] overflow-y-auto space-y-1">
              {nodeLogs.length === 0 ? (
                <span className="text-[var(--color-log-muted)]">// No execution logs yet.</span>
              ) : (
                nodeLogs.map((log, idx) => (
                  <div key={idx} className="whitespace-pre-wrap leading-relaxed">
                    {log}
                  </div>
                ))
              )}
            </div>
          )}

          {taskSubTab === "chat" && (
            <div className="flex flex-col h-full bg-[var(--bg-app)]">
              <Chat
                messages={[
                  {
                    id: "system-agent-init",
                    role: "assistant",
                    content: "I will check the attached file inputs and execute your modifications. You can type instructions below to refine my work.",
                    timestamp: "",
                  },
                  ...chatHistory
                    .filter((msg: any, idx: number) => !(idx === 0 && msg.role === "user"))
                    .map((msg: any, idx: number) => ({
                      id: msg.id || `task-msg-${idx}`,
                      role: msg.role,
                      content: msg.content,
                      timestamp: msg.timestamp || "",
                      attachments: msg.attachments,
                    })),
                ]}
                isStreaming={nodeStatus === "running"}
                streamingMessageId={chatHistory.find((m: any) => m.role === "console" && m.content !== "")?.id || null}
                compact
              />

              <div className="px-3 py-2 border-t border-[var(--color-border-subtle)] bg-[var(--color-surface-header)] flex-shrink-0">
                <ChatInput
                  value={chatMessage}
                  onChange={setChatMessage}
                  onSend={(attachments) => {
                    if ((!chatMessage.trim() && attachments.length === 0) || nodeStatus === "running") return;
                    onExecuteNode(taskNodeId, chatMessage, attachments);
                    setChatMessage("");
                  }}
                  disabled={nodeStatus === "running"}
                  isStreaming={nodeStatus === "running"}
                  onStop={() => onStopExecution(taskNodeId)}
                  placeholder="Refine work, prompt modifications... (type @ to reference files)"
                />
              </div>
            </div>
          )}
        </div>

        {/* Task Executive Footer Controls */}
        <TaskFooter nodeStatus={nodeStatus} taskNodeId={taskNodeId} onExecute={onExecuteNode} onStop={onStopExecution} hidden={taskSubTab === "chat"} />
      </div>
    </div>
  );
};
