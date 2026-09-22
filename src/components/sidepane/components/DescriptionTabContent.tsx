import React, { useState, useRef } from "react";
import {
  FileText,
  Pencil,
  Eye,
  Columns,
  Bold,
  Italic,
  Heading,
  Code as CodeIcon,
  List,
  Sparkles
} from "lucide-react";
import { useWorkspaceStore } from "../../../store";
import { MarkdownRenderer } from "../../ui/MarkdownRenderer";

interface DescriptionTabContentProps {
  selectedNode: any;
  tabId?: string;
}

export const DescriptionTabContent: React.FC<DescriptionTabContentProps> = ({ selectedNode }) => {
  const updateTaskNode = useWorkspaceStore((state) => state.updateTaskNode);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [viewMode, setViewMode] = useState<"edit" | "preview" | "split">("preview");

  const prompt = (selectedNode?.data?.prompt ?? selectedNode?.data?.description) || "";

  const handlePromptChange = (val: string) => {
    if (!selectedNode?.id) return;
    updateTaskNode(selectedNode.id, { prompt: val });
  };

  const insertMarkdown = (prefix: string, suffix = "") => {
    if (!textareaRef.current) return;
    const textarea = textareaRef.current;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const selectedText = prompt.substring(start, end);
    const replacement = `${prefix}${selectedText || "text"}${suffix}`;
    const newPrompt = prompt.substring(0, start) + replacement + prompt.substring(end);

    handlePromptChange(newPrompt);

    setTimeout(() => {
      textarea.focus();
      textarea.setSelectionRange(
        start + prefix.length,
        start + prefix.length + (selectedText ? selectedText.length : 4)
      );
    }, 0);
  };

  const wordsCount = prompt.trim() ? prompt.trim().split(/\s+/).length : 0;
  const charsCount = prompt.length;

  return (
    <div className="flex flex-col h-full bg-[var(--bg-app)] overflow-hidden">
      {/* Tab Header Bar */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--border-color)] bg-[var(--bg-sidebar)]/30 select-none flex-shrink-0">
        <div className="flex items-center space-x-2 min-w-0">
          <FileText size={14} className="text-[var(--accent-color)] flex-shrink-0" />
          <span className="text-xs font-mono font-semibold text-[var(--text-light)] truncate">
            Task Description & Instructions
          </span>
        </div>

        {/* View Mode Toggle Segmented Buttons */}
        <div className="flex items-center space-x-1 bg-[var(--color-surface-sunken)] p-0.5 rounded-md border border-[var(--border-color)] text-[10px] font-mono">
          <button
            onClick={() => setViewMode("edit")}
            className={`flex items-center space-x-1 px-2 py-1 rounded transition-colors cursor-pointer ${
              viewMode === "edit"
                ? "bg-[var(--accent-bg)] text-[var(--text-light)] font-bold shadow-sm"
                : "text-[var(--text-muted)] hover:text-[var(--text-light)]"
            }`}
            title="Edit Description"
          >
            <Pencil size={11} />
            <span>Edit</span>
          </button>
          <button
            onClick={() => setViewMode("preview")}
            className={`flex items-center space-x-1 px-2 py-1 rounded transition-colors cursor-pointer ${
              viewMode === "preview"
                ? "bg-[var(--accent-bg)] text-[var(--text-light)] font-bold shadow-sm"
                : "text-[var(--text-muted)] hover:text-[var(--text-light)]"
            }`}
            title="Preview Markdown"
          >
            <Eye size={11} />
            <span>Preview</span>
          </button>
          <button
            onClick={() => setViewMode("split")}
            className={`flex items-center space-x-1 px-2 py-1 rounded transition-colors cursor-pointer ${
              viewMode === "split"
                ? "bg-[var(--accent-bg)] text-[var(--text-light)] font-bold shadow-sm"
                : "text-[var(--text-muted)] hover:text-[var(--text-light)]"
            }`}
            title="Split Editor & Preview"
          >
            <Columns size={11} />
            <span>Split</span>
          </button>
        </div>
      </div>

      {/* Markdown Helper Formatting Toolbar (visible in edit or split mode) */}
      {(viewMode === "edit" || viewMode === "split") && (
        <div className="flex items-center space-x-1 px-3 py-1.5 border-b border-[var(--border-color)]/60 bg-[var(--bg-sidebar)]/10 text-xs flex-shrink-0">
          <span className="text-[9px] uppercase font-mono font-semibold text-[var(--text-muted)] mr-1 select-none">
            Formatting:
          </span>
          <button
            onClick={() => insertMarkdown("**", "**")}
            className="p-1 text-[var(--text-muted)] hover:text-[var(--text-light)] hover:bg-[var(--color-surface-elevated)] rounded cursor-pointer transition-colors"
            title="Bold"
          >
            <Bold size={13} />
          </button>
          <button
            onClick={() => insertMarkdown("*", "*")}
            className="p-1 text-[var(--text-muted)] hover:text-[var(--text-light)] hover:bg-[var(--color-surface-elevated)] rounded cursor-pointer transition-colors"
            title="Italic"
          >
            <Italic size={13} />
          </button>
          <button
            onClick={() => insertMarkdown("### ")}
            className="p-1 text-[var(--text-muted)] hover:text-[var(--text-light)] hover:bg-[var(--color-surface-elevated)] rounded cursor-pointer transition-colors"
            title="Heading"
          >
            <Heading size={13} />
          </button>
          <button
            onClick={() => insertMarkdown("```\n", "\n```")}
            className="p-1 text-[var(--text-muted)] hover:text-[var(--text-light)] hover:bg-[var(--color-surface-elevated)] rounded cursor-pointer transition-colors"
            title="Code Block"
          >
            <CodeIcon size={13} />
          </button>
          <button
            onClick={() => insertMarkdown("- ")}
            className="p-1 text-[var(--text-muted)] hover:text-[var(--text-light)] hover:bg-[var(--color-surface-elevated)] rounded cursor-pointer transition-colors"
            title="Bulleted List"
          >
            <List size={13} />
          </button>
        </div>
      )}

      {/* Main Content Area */}
      <div className="flex-1 overflow-hidden relative flex flex-col md:flex-row">
        {/* Editor Pane */}
        {(viewMode === "edit" || viewMode === "split") && (
          <div
            className={`flex-1 flex flex-col h-full overflow-hidden ${
              viewMode === "split" ? "border-b md:border-b-0 md:border-r border-[var(--border-color)]" : ""
            }`}
          >
            <textarea
              ref={textareaRef}
              value={prompt}
              onChange={(e) => handlePromptChange(e.target.value)}
              placeholder="Enter detailed prompt instructions or task description here (Markdown formatting supported)..."
              className="w-full h-full p-3 bg-[var(--color-surface-sunken)] text-[var(--text-light)] font-mono text-xs leading-relaxed outline-none resize-none overflow-y-auto selection:bg-[var(--accent-bg)]"
              spellCheck={false}
            />
          </div>
        )}

        {/* Preview Pane */}
        {(viewMode === "preview" || viewMode === "split") && (
          <div className="flex-1 flex flex-col h-full overflow-y-auto p-4 bg-[var(--bg-app)]">
            {prompt.trim() ? (
              <MarkdownRenderer content={prompt} className="text-xs text-[var(--text-normal)]" />
            ) : (
              <div className="h-full flex flex-col items-center justify-center text-center p-6 text-[var(--text-muted)] select-none">
                <Sparkles size={24} className="mb-2 opacity-40 text-[var(--accent-color)]" />
                <p className="text-xs font-mono">No description provided yet.</p>
                <p className="text-[10px] mt-1 text-[var(--text-muted)]">
                  Type instructions in the editor pane to see rendered Markdown formatting here.
                </p>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Footer Bar */}
      <div className="px-3 py-1.5 border-t border-[var(--border-color)] bg-[var(--bg-sidebar)]/20 flex items-center justify-between text-[10px] font-mono text-[var(--text-muted)] select-none flex-shrink-0">
        <span className="flex items-center space-x-1">
          <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-status-success)] inline-block" />
          <span>Markdown Enabled</span>
        </span>
        <span>
          {wordsCount} word{wordsCount === 1 ? "" : "s"} • {charsCount} character{charsCount === 1 ? "" : "s"}
        </span>
      </div>
    </div>
  );
};
