import React, { useCallback, useEffect, useRef, useState } from "react";
import { DiffEditor } from "@monaco-editor/react";
import { CustomSelect } from "../../CustomSelect";
import { Save, RotateCcw, Trash2, ChevronLeft, ChevronRight } from "lucide-react";
import { useDiffViewMode } from "../../../hooks/useDiffViewMode";
import { DiffViewToggle } from "../../ui/DiffViewToggle";
import { useWorkspaceStore } from "../../../store";
import { getMonacoLanguageId } from "../../../services/languageRegistry";
import { createMonacoDiffOptions } from "../../../editor/monacoOptions";
import { invoke } from "@tauri-apps/api/core";

interface DiffTabContentProps { selectedNode: any; modifiedFiles: string[]; activeDiffFile: string; setActiveDiffFile: (file: string) => void; originalCode: string; modifiedCode: string; isDiffLoading?: boolean; tabId?: string; }

/** Displays a task's recorded workspace changes. Clearing history never deletes workspace files. */
export const DiffTabContent: React.FC<DiffTabContentProps> = ({ selectedNode, modifiedFiles, activeDiffFile, setActiveDiffFile, originalCode, modifiedCode, isDiffLoading, tabId }) => {
  const updateTaskNode = useWorkspaceStore((state) => state.updateTaskNode);
  const editorFontSize = useWorkspaceStore((state) => state.typographyPreferences.editorFontSize);
  const [editedCode, setEditedCode] = useState("");
  const [isDirty, setIsDirty] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const editorRef = useRef<any>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const { viewMode, isAutoMode, toggleViewMode, enableAutoMode, renderSideBySide } = useDiffViewMode(containerRef);
  const options = modifiedFiles.map((file) => ({ id: file, name: file.split("/").pop() || file }));
  const index = modifiedFiles.indexOf(activeDiffFile);

  useEffect(() => { setEditedCode(modifiedCode); setIsDirty(false); }, [activeDiffFile, modifiedCode]);
  const onMount = useCallback((editor: any) => {
    editorRef.current = editor;
    const modified = editor.getModifiedEditor();
    modified.updateOptions({ readOnly: false });
    modified.onDidChangeModelContent(() => { const value = modified.getValue(); setEditedCode(value); setIsDirty(value !== modifiedCode); });
  }, [modifiedCode]);
  const persist = async () => {
    if (!activeDiffFile || !isDirty) return;
    setIsSaving(true);
    try {
      await invoke("write_file_disk", { path: activeDiffFile, content: editedCode });
      const original = selectedNode.data?.originalFileContents || {};
      updateTaskNode(selectedNode.id, { originalFileContents: { ...original, [activeDiffFile]: original[activeDiffFile] ?? originalCode }, generatedFileContents: { ...(selectedNode.data?.generatedFileContents || {}), [activeDiffFile]: editedCode } });
      setIsDirty(false);
      if (tabId) void (await import("../../tabs/canvas/services/canvasFileService")).canvasFileService.autoSaveCanvas(tabId);
    } finally { setIsSaving(false); }
  };
  const clearFile = async () => {
    const originals = { ...(selectedNode.data?.originalFileContents || {}) }; const generated = { ...(selectedNode.data?.generatedFileContents || {}) };
    delete originals[activeDiffFile]; delete generated[activeDiffFile];
    updateTaskNode(selectedNode.id, { modifiedFiles: modifiedFiles.filter((file) => file !== activeDiffFile), originalFileContents: originals, generatedFileContents: generated });
    if (tabId) void (await import("../../tabs/canvas/services/canvasFileService")).canvasFileService.autoSaveCanvas(tabId);
  };
  const clearAll = async () => { updateTaskNode(selectedNode.id, { modifiedFiles: [], originalFileContents: {}, generatedFileContents: {} }); if (tabId) void (await import("../../tabs/canvas/services/canvasFileService")).canvasFileService.autoSaveCanvas(tabId); };

  return <div ref={containerRef} className="flex flex-col h-full w-full">
    {selectedNode.type === "taskNode" && modifiedFiles.length > 0 && <div className="px-4 py-2 border-b border-[var(--border-color)] bg-[var(--bg-sidebar)] flex items-center justify-between text-xs font-mono"><div className="flex items-center space-x-2"><span className="text-[var(--text-muted)]">Changes:</span><button id="previous-change-btn" onClick={() => index > 0 && setActiveDiffFile(modifiedFiles[index - 1])} disabled={index <= 0}><ChevronLeft size={14} /></button><button id="next-change-btn" onClick={() => index < modifiedFiles.length - 1 && setActiveDiffFile(modifiedFiles[index + 1])} disabled={index >= modifiedFiles.length - 1}><ChevronRight size={14} /></button><CustomSelect value={activeDiffFile} onChange={setActiveDiffFile} options={options} className="w-64" /><button id="clear-change-history-file-btn" onClick={clearFile} title="Clear this file from node change history"><Trash2 size={14} /></button><button id="clear-change-history-btn" onClick={clearAll} className="text-[var(--text-muted)] hover:text-[var(--color-status-danger)]"><Trash2 size={12} /> Clear history</button></div><DiffViewToggle viewMode={viewMode} isAutoMode={isAutoMode} onToggle={toggleViewMode} onEnableAuto={enableAutoMode} /></div>}
    {selectedNode.type === "taskNode" && activeDiffFile && <div className="px-4 py-2 border-b border-[var(--border-color)] flex justify-end gap-2"><span className="mr-auto text-[10px] text-[var(--text-muted)]">{isDiffLoading ? "Loading..." : isDirty ? "Modified (unsaved)" : "Saved to workspace"}</span><button id="reset-workspace-change-btn" onClick={() => { editorRef.current?.getModifiedEditor().setValue(modifiedCode); }} disabled={!isDirty || isSaving}><RotateCcw size={11} /> Reset</button><button id="save-workspace-change-btn" onClick={persist} disabled={!isDirty || isSaving} title="Save changes to workspace"><Save size={11} /> {isSaving ? "Saving..." : "Save to Workspace"}</button></div>}
    <div className="flex-1 min-h-0">{activeDiffFile ? <DiffEditor height="100%" language={getMonacoLanguageId(activeDiffFile)} theme="rusty-custom-theme" original={originalCode} modified={editedCode} onMount={onMount} options={createMonacoDiffOptions(editorFontSize, { readOnly: false, minimap: { enabled: false }, scrollBeyondLastLine: false, lineNumbers: "on", renderSideBySide })} /> : <div className="h-full flex flex-col items-center justify-center text-center text-[var(--text-muted)] font-mono text-xs"><strong className="text-[var(--accent-color)]">No changes yet</strong><span>This node has not written workspace files yet.</span></div>}</div>
  </div>;
};
