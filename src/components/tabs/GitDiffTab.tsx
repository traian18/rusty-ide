import React, { useState, useEffect, useRef } from "react";
import { DiffEditor } from "@monaco-editor/react";
import { TreePine } from "lucide-react";
import { useWorkspaceStore } from "../../store";
import { getFileTypeDetails } from "../../services/fileTypeService";
import { useDiffViewMode } from "../../hooks/useDiffViewMode";
import { DiffViewToggle } from "../ui/DiffViewToggle";
import { createMonacoDiffOptions } from "../../editor/monacoOptions";
import { gitErrorMessage } from "../git/gitErrors";
import type { TabOfType } from "../../tabs/types";
import { loadGitDiffContent } from "./GitDiffContent";

interface GitDiffTabProps {
  tab: TabOfType<"git-diff">;
  isActive: boolean;
}

export const GitDiffTab: React.FC<GitDiffTabProps> = ({ tab, isActive }) => {
  const editorFontSize = useWorkspaceStore((state) => state.typographyPreferences.editorFontSize);
  const revealFileInTree = useWorkspaceStore((state) => state.revealFileInTree);

  const [gitOriginalCode, setGitOriginalCode] = useState("");
  const [gitModifiedCode, setGitModifiedCode] = useState("");
  const [loading, setLoading] = useState(true);
  const diffEditorRef = useRef<any>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const { viewMode, isAutoMode, toggleViewMode, enableAutoMode, renderSideBySide } = useDiffViewMode(containerRef);

  useEffect(() => {
    if (!tab.repoPath) return;

    const fetchGitDiffContent = async () => {
      setLoading(true);
      try {
        console.log(`GitDiffTab loading diff for: ${tab.path} (${tab.diffType || "unstaged"})`);
        const { original, modified } = await loadGitDiffContent(tab);
        setGitOriginalCode(original);
        setGitModifiedCode(modified);
      } catch (err) {
        console.error("GitDiffTab failed to load git diff:", err);
        const message = gitErrorMessage(err);
        setGitOriginalCode(`// Error reading original content: ${message}`);
        setGitModifiedCode(`// Error reading modified content: ${message}`);
      } finally {
        setLoading(false);
      }
    };

    fetchGitDiffContent();
  }, [tab.path, tab.diffType, tab.commitHash, tab.repoPath]);

  // Adjust editor size when tab active state changes
  useEffect(() => {
    if (isActive && diffEditorRef.current) {
      setTimeout(() => {
        if (diffEditorRef.current) {
          diffEditorRef.current.layout();
        }
      }, 50);
    }
  }, [isActive]);

  const handleEditorMount = (editor: any) => {
    diffEditorRef.current = editor;
    setTimeout(() => {
      editor.layout();
    }, 50);
  };

  const getEditorLanguage = (filePath: string): string => {
    return getFileTypeDetails(filePath).language;
  };

  return (
    <div ref={containerRef} className="flex-1 flex flex-col h-full overflow-hidden relative">
      {/* Header info */}
      <div className="px-4 py-2 border-b border-[var(--border-color)] bg-[var(--bg-sidebar)] flex items-center justify-between text-xs font-mono">
        <div className="flex items-center space-x-3">
          <span className="text-[var(--text-light)] font-bold">{tab.title}</span>
          <span className="text-[var(--text-muted)] text-[10px] truncate max-w-[400px]">
            {tab.path}
          </span>
        </div>
        <div className="flex items-center space-x-2">
          <button
            onClick={() => revealFileInTree(tab.path)}
            className="bg-[var(--bg-sidebar)] border border-[var(--border-color)] text-[var(--text-muted)] hover:text-[var(--text-light)] hover:border-[var(--border-active)] p-1.5 rounded-md text-[10px] font-mono font-bold transition-all shadow-md cursor-pointer flex items-center space-x-1"
            title="Reveal in File Tree"
          >
            <TreePine size={10} />
            <span>Reveal</span>
          </button>
          <DiffViewToggle
            viewMode={viewMode}
            isAutoMode={isAutoMode}
            onToggle={toggleViewMode}
            onEnableAuto={enableAutoMode}
          />
        </div>
      </div>

      {/* Diff editor viewport */}
      <div className="flex-1 w-full h-full relative bg-[var(--bg-app)]">
        {loading ? (
          <div className="w-full h-full flex flex-col items-center justify-center font-mono text-xs text-[var(--text-muted)]">
            <span>Loading Git diff changes...</span>
          </div>
        ) : (
          <DiffEditor
            height="100%"
            language={getEditorLanguage(tab.path)}
            theme="rusty-custom-theme"
            original={gitOriginalCode}
            modified={gitModifiedCode}
            onMount={handleEditorMount}
            options={createMonacoDiffOptions(editorFontSize, {
              readOnly: true,
              minimap: { enabled: false },
              scrollBeyondLastLine: false,
              lineNumbers: "on",
              renderSideBySide,
            })}
          />
        )}
      </div>
    </div>
  );
};
