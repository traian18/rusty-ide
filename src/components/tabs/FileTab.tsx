// The file tab: a coordinator over the hooks in ./fileTab, one per feature
// (loading, auto-save, blame, change gutter, go-to-definition, inline chat).
// A new file feature is a hook and a view there, not more state here.

import React, { useEffect, useRef, useState } from "react";
import Editor, { loader } from "@monaco-editor/react";
import { useWorkspaceStore } from "../../store";
import { getFileTypeDetails } from "../../services/fileTypeService";
import { themes, defineMonacoTheme } from "../../theme";
import { disableBuiltInTsDiagnostics } from "../../services/monacoDiagnostics";
import { MarkdownRenderer } from "../ui/MarkdownRenderer";
import { InlineChat } from "../inline-chat/InlineChat";
import { createMonacoEditorOptions } from "../../editor/monacoOptions";
import { UnsupportedFilePreview, formatFileSize } from "./UnsupportedFilePreview";
import { ImageFilePreview } from "./ImageFilePreview";
import type { TabOfType } from "../../tabs/types";
import { DefinitionMenu } from "./fileTab/DefinitionMenu";
import { FileTabToolbar } from "./fileTab/FileTabToolbar";
import { type FileLocation, useFileLocation } from "./fileTab/fileLocation";
import { useAutoSave } from "./fileTab/useAutoSave";
import { useDefinitionLookup } from "./fileTab/useDefinitionLookup";
import { type FileContent, useFileContent } from "./fileTab/useFileContent";
import { useFileEditor } from "./fileTab/useFileEditor";
import { type GitBlame, useGitBlame } from "./fileTab/useGitBlame";
import { useGitGutter } from "./fileTab/useGitGutter";
import { useInlineChat } from "./fileTab/useInlineChat";

// Register custom Monaco theme once
loader.init().then((monaco) => {
  const activeThemeId = useWorkspaceStore.getState().activeThemeId;
  const activeTheme = themes[activeThemeId] || themes.dark;
  defineMonacoTheme(monaco, activeTheme);
  // Monaco's built-in TS worker has no awareness of this project's actual
  // tsconfig, so left enabled it flags false-positive module/JSX errors --
  // see monacoDiagnostics.ts's own doc comment.
  disableBuiltInTsDiagnostics(monaco);
}).catch((error) => {
  console.warn("Failed to initialize Monaco for file tabs:", error);
});

interface FileTabProps {
  tab: TabOfType<"file">;
  isActive: boolean;
}

/** A Markdown file opens in preview; the toolbar toggle flips to its source. */
function useMarkdownPreview(path: string, isMarkdown: boolean): [boolean, () => void] {
  const [markdownPreview, setMarkdownPreview] = useState(false);
  useEffect(() => {
    setMarkdownPreview(isMarkdown);
  }, [isMarkdown, path]);
  return [isMarkdown && markdownPreview, () => setMarkdownPreview((preview) => !preview)];
}

const LoadingFile: React.FC = () => (
  <div className="w-full h-full flex items-center justify-center font-mono text-xs text-[var(--text-muted)] bg-[var(--bg-app)]">
    <span>Loading file content...</span>
  </div>
);

const ImageFilePane: React.FC<{ tab: TabOfType<"file">; content: FileContent }> = ({ tab, content }) => {
  const fileName = tab.title ?? tab.path;
  // Neither set (shouldn't happen: the image load always sets one before
  // clearing `loading`) also falls through to the unsupported card rather
  // than rendering nothing.
  if (content.imageLoadError || !content.imagePreview) {
    return <UnsupportedFilePreview path={tab.path} fileName={fileName} sizeBytes={0} />;
  }
  return (
    <ImageFilePreview
      path={tab.path}
      fileName={fileName}
      src={content.imagePreview.dataUrl}
      sizeBytes={content.imagePreview.sizeBytes}
    />
  );
};

const LargeFileBanner: React.FC<{ content: FileContent }> = ({ content }) => {
  if (!content.readOnly || content.fileSafety.kind !== "too_large") return null;
  return (
    <div className="absolute top-0 left-0 right-0 z-20 flex items-center justify-between gap-3 px-4 py-2 bg-[var(--color-status-warning-bg)] border-b border-[var(--color-status-warning-border)] text-[var(--color-status-warning)] font-mono text-[11px]">
      <span>
        This file is {formatFileSize(content.fileSafety.sizeBytes)}, above the large-file threshold -- opened read-only.
      </span>
      <button
        type="button"
        onClick={content.loadAnyway}
        className="flex-shrink-0 px-2 py-1 rounded border border-[var(--color-status-warning-border)] hover:bg-[var(--color-status-warning-bg)]/60 cursor-pointer"
      >
        Load anyway (editable)
      </button>
    </div>
  );
};

interface FileEditorProps {
  location: FileLocation;
  language: string;
  content: FileContent;
  blame: GitBlame;
  onChange: (value: string | undefined) => void;
  onMount: (editor: any, monaco: any) => void;
}

const FileEditor: React.FC<FileEditorProps> = ({ location, language, content, blame, onChange, onMount }) => {
  const editorFontSize = useWorkspaceStore((state) => state.typographyPreferences.editorFontSize);
  return (
    <Editor
      height="100%"
      path={location.monacoModelUri}
      language={language}
      theme="rusty-custom-theme"
      value={content.fileContent}
      onChange={onChange}
      onMount={onMount}
      keepCurrentModel
      options={createMonacoEditorOptions(editorFontSize, {
        minimap: { enabled: true },
        scrollBeyondLastLine: false,
        readOnly: content.readOnly,
        lineNumbers: blame.lineNumbers,
        lineNumbersMinChars: blame.lineNumbersMinChars,
        lineDecorationsWidth: 10,
        tabSize: 2,
      })}
    />
  );
};

export const FileTab: React.FC<FileTabProps> = ({ tab, isActive }) => {
  const location = useFileLocation(tab);
  const content = useFileContent(tab, location);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const editorRef = useRef<any>(null);
  const blame = useGitBlame(tab, location);
  const gutter = useGitGutter(tab, location, editorRef, content.fileContent);
  const definitions = useDefinitionLookup(tab, location.rootPath, containerRef);
  const inlineChat = useInlineChat(tab, containerRef, editorRef);
  const autoSave = useAutoSave(tab, location.canvasTabId, gutter.reloadHead);
  const [markdownPreview, toggleMarkdownPreview] = useMarkdownPreview(tab.path, location.isMarkdown);
  const language = content.shebangLanguage ?? getFileTypeDetails(tab.path).language;
  const handleEditorMount = useFileEditor(editorRef, { tab, isActive, location, language, blame, gutter, definitions, inlineChat, autoSave });
  const handleEditorChange = (value: string | undefined) => {
    if (value === undefined) return;
    content.setFileContent(value);
    autoSave.schedule(value);
  };

  if (content.loading) return <LoadingFile />;
  if (location.isImage) return <ImageFilePane tab={tab} content={content} />;
  if (content.fileSafety.kind === "binary") {
    return <UnsupportedFilePreview path={tab.path} fileName={tab.title ?? tab.path} sizeBytes={content.fileSafety.sizeBytes} />;
  }

  return (
    <div ref={containerRef} className="w-full h-full relative bg-[var(--bg-app)]">
      <FileTabToolbar
        tab={tab}
        repoPath={location.repoPath}
        isMarkdown={location.isMarkdown}
        markdownPreview={markdownPreview}
        onToggleMarkdown={toggleMarkdownPreview}
        showBlame={blame.showBlame}
        onToggleBlame={blame.toggle}
      />
      {definitions.menu && <DefinitionMenu menu={definitions.menu} onOpen={definitions.open} onClose={definitions.close} />}
      {inlineChat.state && (
        <InlineChat
          sessionId={inlineChat.sessionId}
          context={inlineChat.state.context}
          position={inlineChat.state.position}
          onClose={inlineChat.close}
        />
      )}
      <LargeFileBanner content={content} />
      {markdownPreview ? (
        <div className="h-full overflow-auto px-6 py-5 pr-24 scrollbar-wider">
          <MarkdownRenderer content={content.fileContent} className="max-w-4xl mx-auto" />
        </div>
      ) : (
        <FileEditor location={location} language={language} content={content} blame={blame} onChange={handleEditorChange} onMount={handleEditorMount} />
      )}
    </div>
  );
};
