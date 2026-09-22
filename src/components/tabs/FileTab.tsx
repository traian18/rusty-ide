import React, { useState, useEffect, useRef, useMemo } from "react";
import Editor, { loader } from "@monaco-editor/react";
import { useWorkspaceStore } from "../../store";
import { invoke } from "@tauri-apps/api/core";
import { VfsRegistry, VFS_CHANGED_EVENT, type VfsChangedDetail } from "../../services/vfs";
import { getFileTypeDetails } from "../../services/fileTypeService";
import { getMonacoLanguageId, resolveLanguage } from "../../services/languageRegistry";
import { themes, defineMonacoTheme } from "../../theme";
import { Eye, FileCode2, FileSearch, GitBranch, History, Loader2, TreePine, X } from "lucide-react";
import { disableBuiltInTsDiagnostics } from "../../services/monacoDiagnostics";
import { searchService, SearchMatch } from "../../services/searchService";
import { MarkdownRenderer } from "../ui/MarkdownRenderer";
import { InlineChat } from "../inline-chat/InlineChat";
import type { EditorSelectionContext } from "../../harness/contract";
import { createMonacoEditorOptions } from "../../editor/monacoOptions";
import { resolveRepositoryForPath } from "../git/resolveRepositoryForPath";
import { UnsupportedFilePreview, formatFileSize } from "./UnsupportedFilePreview";
import { ImageFilePreview } from "./ImageFilePreview";
import { isImageFile, getImageMimeType } from "../../services/imageFile";
import type { TabOfType } from "../../tabs/types";

const DEFINITION_MENU_WIDTH = 360;
const DEFINITION_MENU_MAX_HEIGHT = 320;
const DEFINITION_MENU_MARGIN = 12;
const INLINE_CHAT_MARGIN = 12;

type DefinitionCandidate = SearchMatch & { score: number; relativePath: string };

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

export const FileTab: React.FC<FileTabProps> = ({ tab, isActive }) => {
  const editorFontSize = useWorkspaceStore((state) => state.typographyPreferences.editorFontSize);
  const [fileContent, setFileContent] = useState("");
  const [loading, setLoading] = useState(true);
  const [showBlame, setShowBlame] = useState(false);
  const [blameData, setBlameData] = useState<Record<number, any>>({});
  const [maxBlameLength, setMaxBlameLength] = useState(5);
  const [definitionMenu, setDefinitionMenu] = useState<{
    symbol: string;
    x: number;
    y: number;
    loading: boolean;
    results: DefinitionCandidate[];
    message?: string;
  } | null>(null);
  const [markdownPreview, setMarkdownPreview] = useState(false);
  // Set only when a shebang line changes the language resolution away from
  // the filename-only guess (REFACTOR_PLAN.md PR 6 commit 5) -- an
  // extensionless script is the only case that can happen for, so this
  // stays null for every other file.
  const [shebangLanguage, setShebangLanguage] = useState<string | null>(null);
  // check_file_open_safety's verdict for this tab's file (REFACTOR_PLAN.md
  // PR 6 commit 8). "safe" is the default so a file already loaded before
  // this check runs (or one the check errored on -- see the effect below)
  // renders exactly like it did before this feature existed.
  const [fileSafety, setFileSafety] = useState<
    { kind: "safe" } | { kind: "binary"; sizeBytes: number } | { kind: "too_large"; sizeBytes: number }
  >({ kind: "safe" });
  // "Load anyway" override for a too_large file, reset per tab.path change.
  const [forceEditableLargeFile, setForceEditableLargeFile] = useState(false);
  const [inlineChat, setInlineChat] = useState<{
    context: EditorSelectionContext;
    position: { x: number; y: number };
  } | null>(null);
  // Populated instead of fileContent/fileSafety when isImage is true --
  // read_file_as_base64 handles binary bytes read_file_disk/VfsRegistry
  // can't, and images never go through Monaco's text-editing path at all.
  const [imagePreview, setImagePreview] = useState<{ dataUrl: string; sizeBytes: number } | null>(null);
  const [imageLoadError, setImageLoadError] = useState<string | null>(null);
  const saveTimeoutRef = useRef<any>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const editorRef = useRef<any>(null);
  const definitionRequestRef = useRef(0);
  const inlineChatCommandRef = useRef<{ dispose: () => void } | null>(null);
  const inlineChatSessionIdRef = useRef(`inline-chat-${tab.id}-${Date.now()}`);

  const rootPath = useWorkspaceStore((state) => state.rootPath);
  const openTab = useWorkspaceStore((state) => state.openTab);
  const revealFileInTree = useWorkspaceStore((state) => state.revealFileInTree);
  const repositories = useWorkspaceStore((state) => state.repositories);

  // The repository that actually owns this file (REFACTOR_PLAN.md PR 5b
  // commit 19) -- falls back to the workspace root, the pre-PR-5 behavior,
  // when repositories hasn't been discovered yet or the file isn't inside
  // any discovered submodule/worktree. Computed per-render rather than
  // stored on the tab itself: repositories is already global store state,
  // so there's nothing to gain from threading a repoPath field through
  // every place a file tab gets created.
  const fileRepoPath = resolveRepositoryForPath(tab.path, repositories)?.worktreePath ?? rootPath;

  const isMarkdown = getFileTypeDetails(tab.path).language === "markdown";
  const isImage = isImageFile(tab.path);

  useEffect(() => {
    setMarkdownPreview(isMarkdown);
  }, [isMarkdown, tab.path]);

  const canvasTabId = useMemo(() => {
    if (tab.vfsTabId) return tab.vfsTabId;
    const contexts = useWorkspaceStore.getState().canvasContexts;
    for (const tId in contexts) {
      const ctx = contexts[tId];
      const hasNode = ctx.nodes.some((n: any) => n.data?.modifiedFiles?.includes(tab.path));
      if (hasNode) return tId;
    }
    return undefined;
  }, [tab.path, tab.vfsTabId]);

  const monacoModelUri = useMemo(() => {
    if (tab.vfsTabId) {
      const cleanPath = tab.path.replace(/^\//, "");
      return `vfs://${tab.vfsTabId}/${cleanPath}`;
    }
    return `file://${tab.path}`;
  }, [tab.path, tab.vfsTabId]);

  // Load Git blame details. Skipped for images and VFS-only files: blame is a per-line
  // annotation on git commits and has no meaning for virtual or image files.
  useEffect(() => {
    if (!fileRepoPath || !tab.path || isImage || tab.vfsTabId) return;
    const fetchBlame = async () => {
      try {
        const blameLines: any[] = await invoke("git_blame", { rootDir: fileRepoPath, filePath: tab.path });
        const map: Record<number, any> = {};
        let maxLen = 5;
        blameLines.forEach((line) => {
          map[line.line_number] = line;
          const label = `${line.author} (${line.date}) │ ${line.line_number}`;
          if (label.length > maxLen) {
            maxLen = label.length;
          }
        });
        setBlameData(map);
        setMaxBlameLength(maxLen);
      } catch (err) {
        console.warn("Failed to fetch git blame for file:", err);
      }
    };
    fetchBlame();
  }, [tab.path, fileRepoPath]);

  // Load content on mount
  useEffect(() => {
    setShebangLanguage(null);
    setFileSafety({ kind: "safe" });
    setForceEditableLargeFile(false);
    setImagePreview(null);
    setImageLoadError(null);

    const fetchImageContent = async () => {
      // Images skip check_file_open_safety and VfsRegistry entirely: the
      // safety check's NUL-byte sniff would just classify them "binary"
      // anyway (SVG being the one exception, since it's real text), and
      // VfsRegistry.readFile expects UTF-8 text, which would corrupt raw
      // image bytes rather than error cleanly on them.
      try {
        const base64: string = await invoke("read_file_as_base64", { path: tab.path });
        const mime = getImageMimeType(tab.path);
        // atob'd length is the exact decoded byte count -- cheaper and
        // more accurate than a second stat round trip just for the
        // caption's file size.
        const sizeBytes = Math.floor((base64.length * 3) / 4) - (base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0);
        setImagePreview({ dataUrl: `data:${mime};base64,${base64}`, sizeBytes });
      } catch (err: any) {
        console.error("FileTab failed to read image:", err);
        setImageLoadError(err?.message ? String(err.message) : "Failed to read image file");
      } finally {
        setLoading(false);
      }
    };

    if (isImage) {
      fetchImageContent();
      return;
    }

    const fetchFileContent = async () => {
      let safety: { kind: "safe" } | { kind: "binary"; sizeBytes: number } | { kind: "too_large"; sizeBytes: number } = {
        kind: "safe",
      };
      if (!tab.vfsTabId) {
        try {
          const thresholdBytes = useWorkspaceStore.getState().editorFileSafety.largeFileThresholdBytes;
          const raw: any = await invoke("check_file_open_safety", { path: tab.path, maxBytes: thresholdBytes });
          safety = raw.kind === "safe" ? { kind: "safe" } : { kind: raw.kind, sizeBytes: raw.size_bytes };
        } catch (err) {
          console.warn("check_file_open_safety failed, proceeding as safe:", err);
        }
      }
      setFileSafety(safety);

      if (safety.kind === "binary") {
        setLoading(false);
        return;
      }

      try {
        console.log(`FileTab reading VFS path: ${tab.path} (canvas: ${canvasTabId || "global"})`);
        const content: string = await VfsRegistry.getOrCreate(canvasTabId).readFile(tab.path);
        setFileContent(content);
        if (getMonacoLanguageId(tab.path) === "plaintext") {
          const firstLine = content.split("\n", 1)[0] ?? "";
          const resolved = resolveLanguage(tab.path, firstLine);
          if (resolved.id !== "plaintext") setShebangLanguage(resolved.id);
        }
      } catch (err: any) {
        console.error("FileTab failed to read VFS:", err);
        setFileContent(`// Error reading file: ${err.message}`);
      } finally {
        setLoading(false);
      }
    };

    fetchFileContent();

    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
      inlineChatCommandRef.current?.dispose();
      inlineChatCommandRef.current = null;
      window.setTimeout(() => {
        const monaco = (window as any).monaco;
        if (!monaco) return;
        const uri = monaco.Uri.parse(monacoModelUri);
        const model = monaco.editor.getModel(uri);
        const stillOpenElsewhere = useWorkspaceStore
          .getState()
          .tabs.some((t) => t.type === "file" && t.id === tab.id);
        if (model && !model.isDisposed?.() && !stillOpenElsewhere) {
          model.dispose();
        }
      }, 0);
    };
  }, [tab.path, tab.id, tab.vfsTabId, canvasTabId, isImage, monacoModelUri]);

  // Live reload content when canvas VFS changes
  useEffect(() => {
    if (!canvasTabId) return;
    const handleVfsChanged = (event: Event) => {
      const detail = (event as CustomEvent<VfsChangedDetail>).detail;
      if (detail && detail.tabId === canvasTabId) {
        const affects = !detail.paths || detail.paths.some(
          (p) => p === tab.path || tab.path.endsWith(p) || p.endsWith(tab.path)
        );
        if (affects) {
          VfsRegistry.getOrCreate(canvasTabId)
            .readFile(tab.path)
            .then((content) => setFileContent(content))
            .catch((err) => console.warn("Live VFS reload failed:", err));
        }
      }
    };
    window.addEventListener(VFS_CHANGED_EVENT, handleVfsChanged);
    return () => window.removeEventListener(VFS_CHANGED_EVENT, handleVfsChanged);
  }, [canvasTabId, tab.path]);

  // Trigger editor layout when tab becomes active
  useEffect(() => {
    if (isActive && editorRef.current) {
      setTimeout(() => {
        if (editorRef.current) {
          editorRef.current.layout();
        }
      }, 50);
    }
  }, [isActive]);

  const handleEditorChange = (value: string | undefined) => {
    if (value === undefined) return;
    setFileContent(value);

    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }

    saveTimeoutRef.current = setTimeout(async () => {
      try {
        if (canvasTabId) {
          await VfsRegistry.getOrCreate(canvasTabId).writeFile(tab.path, value);
          console.log(`FileTab saved to VFS (${canvasTabId}): ${tab.title}`);
        } else {
          await invoke("write_file_disk", { path: tab.path, content: value });
          console.log(`FileTab auto-saved: ${tab.title}`);
          useWorkspaceStore.getState().loadGitStatus(); // Reload git changes list
        }
      } catch (err) {
        console.error("FileTab save failed:", err);
      }
    }, 500);
  };

  const handleOpenFileHistory = () => {
    // Repo-scoped now: the identity carries the repository, so the same file
    // in two repositories no longer collides on one history tab. Passing
    // fileRepoPath explicitly (found while auditing blame, PR 5b commit 19)
    // fixes a real bug: omitting it left the git-history policy default to
    // the workspace root regardless of which repository the file actually
    // lives in, so history for a file inside a submodule opened scoped to
    // the whole workspace instead.
    openTab({ type: "git-history", path: tab.path, repoPath: fileRepoPath || undefined });
  };

  const scrollToLine = (editor: any, lineNum: number) => {
    if (!editor || !lineNum) return;
    editor.revealLineInCenter(lineNum);
    editor.setPosition({ lineNumber: lineNum, column: 1 });
    editor.focus();
  };

  useEffect(() => {
    if (editorRef.current && tab.line) {
      scrollToLine(editorRef.current, tab.line);
    }
  }, [tab.line]);

  useEffect(() => {
    if (!definitionMenu) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setDefinitionMenu(null);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [definitionMenu]);

  const getRelativePath = (filePath: string) => {
    if (!rootPath) return filePath;
    return filePath.startsWith(rootPath) ? filePath.slice(rootPath.length).replace(/^\/+/, "") : filePath;
  };

  const scoreDefinitionMatch = (match: SearchMatch, symbol: string, currentLine: number): number => {
    if (!match.is_content_match || !match.content) return -1;
    const escaped = symbol.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const line = match.content.trim();
    const word = new RegExp(`\\b${escaped}\\b`);
    if (!word.test(line)) return -1;

    let score = 10;
    if (match.path === tab.path) score += 4;
    if (match.line === currentLine && match.path === tab.path) score -= 8;
    if (new RegExp(`\\b(class|interface|enum|record|struct|trait|type)\\s+${escaped}\\b`).test(line)) score += 100;
    if (new RegExp(`\\b(function|def|fn|func)\\s+${escaped}\\s*\\(`).test(line)) score += 95;
    if (new RegExp(`\\b(public|private|protected|static|final|abstract|override|virtual|async|export|pub)\\b.*\\b${escaped}\\s*\\(`).test(line)) score += 90;
    if (new RegExp(`^\\s*[\\w$<>\\[\\],.?]+(?:\\s+[\\w$<>\\[\\],.?]+)*\\s+${escaped}\\s*\\(`).test(line)) score += 80;
    if (new RegExp(`^\\s*(const|let|var)\\s+${escaped}\\b`).test(line)) score += 75;
    if (new RegExp(`^\\s*${escaped}\\s*[:=]`).test(line)) score += 65;
    if (new RegExp(`\\.${escaped}\\s*\\(`).test(line)) score -= 45;
    if (/^\s*(return|if|while|for|switch|catch)\b/.test(line)) score -= 35;
    return score;
  };

  const findDefinitionCandidates = async (symbol: string, currentLine: number): Promise<DefinitionCandidate[]> => {
    if (!rootPath) return [];
    const matches = await searchService.searchProject({
      rootDir: rootPath,
      query: symbol,
      matchCase: true,
      wholeWord: true,
      isRegex: false,
    });

    const ranked = matches
      .map((match) => ({
        ...match,
        score: scoreDefinitionMatch(match, symbol, currentLine),
        relativePath: getRelativePath(match.path),
      }))
      .filter((match) => match.score > 0)
      .sort((a, b) => b.score - a.score || a.relativePath.localeCompare(b.relativePath) || a.line - b.line);

    return ranked.slice(0, 12);
  };

  const openDefinitionCandidate = (candidate: DefinitionCandidate) => {
    openTab({
      type: "file",
      path: candidate.path,
      title: candidate.name,
      line: candidate.line > 0 ? candidate.line : undefined,
    });
    setDefinitionMenu(null);
  };

  const getDefinitionMenuPosition = (editor: any, position: any, fallbackEvent: MouseEvent) => {
    const containerRect = containerRef.current?.getBoundingClientRect();
    const editorNode = editor.getDomNode?.();
    const editorRect = editorNode?.getBoundingClientRect?.();
    const visiblePosition = editor.getScrolledVisiblePosition?.(position);

    let anchorX = fallbackEvent.clientX;
    let anchorY = fallbackEvent.clientY;
    if (editorRect && visiblePosition) {
      anchorX = editorRect.left + visiblePosition.left;
      anchorY = editorRect.top + visiblePosition.top + visiblePosition.height;
    }

    const originLeft = containerRect?.left ?? 0;
    const originTop = containerRect?.top ?? 0;
    const containerWidth = containerRect?.width ?? window.innerWidth;
    const containerHeight = containerRect?.height ?? window.innerHeight;

    let x = anchorX - originLeft + 8;
    let y = anchorY - originTop + 6;

    if (x + DEFINITION_MENU_WIDTH > containerWidth - DEFINITION_MENU_MARGIN) {
      x = anchorX - originLeft - DEFINITION_MENU_WIDTH - 8;
    }
    if (y + DEFINITION_MENU_MAX_HEIGHT > containerHeight - DEFINITION_MENU_MARGIN) {
      y = anchorY - originTop - DEFINITION_MENU_MAX_HEIGHT - 8;
    }

    const maxX = Math.max(DEFINITION_MENU_MARGIN, containerWidth - DEFINITION_MENU_WIDTH - DEFINITION_MENU_MARGIN);
    const maxY = Math.max(DEFINITION_MENU_MARGIN, containerHeight - DEFINITION_MENU_MAX_HEIGHT - DEFINITION_MENU_MARGIN);
    return {
      x: Math.min(Math.max(DEFINITION_MENU_MARGIN, x), maxX),
      y: Math.min(Math.max(DEFINITION_MENU_MARGIN, y), maxY),
    };
  };

  const handleDefinitionLookup = async (editor: any, event: any) => {
    const browserEvent = event?.event?.browserEvent;
    if (!browserEvent || (!browserEvent.metaKey && !browserEvent.ctrlKey)) return false;
    if (!event.target?.position) return false;

    const model = editor.getModel();
    const position = event.target.position;
    const word = model?.getWordAtPosition(position);
    const symbol = word?.word;
    if (!symbol || !/^[A-Za-z_$][\w$]*$/.test(symbol)) return false;

    browserEvent.preventDefault?.();
    browserEvent.stopPropagation?.();

    const requestId = ++definitionRequestRef.current;
    const menuPosition = getDefinitionMenuPosition(editor, position, browserEvent);
    setDefinitionMenu({
      symbol,
      x: menuPosition.x,
      y: menuPosition.y,
      loading: true,
      results: [],
    });

    try {
      const results = await findDefinitionCandidates(symbol, position.lineNumber);
      if (definitionRequestRef.current !== requestId) return true;
      setDefinitionMenu((current) => current && current.symbol === symbol
        ? {
            ...current,
            loading: false,
            results,
            message: results.length === 0 ? "No likely definitions found" : undefined,
          }
        : current
      );
    } catch (err: any) {
      if (definitionRequestRef.current !== requestId) return true;
      setDefinitionMenu((current) => current && current.symbol === symbol
        ? { ...current, loading: false, results: [], message: err?.message || "Search failed" }
        : current
      );
    }
    return true;
  };

  const handleEditorMount = (editor: any, monaco: any) => {
    editorRef.current = editor;

    if (monaco) {
      inlineChatCommandRef.current?.dispose();
      inlineChatCommandRef.current = editor.addAction({
        // The id used to be namespaced by editor group, because the same tab
        // could be mounted in two split panes at once. Tab ids are unique now,
        // so there can only ever be one editor per tab.
        id: `rusty.inlineChat.${tab.id}`,
        label: "Open Inline Chat",
        keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter],
        run: () => {
          const model = editor.getModel();
          const selection = editor.getSelection();
          const position = editor.getPosition();
          if (!model || !selection || !position) return;

          const selectedText = selection.isEmpty() ? "" : model.getValueInRange(selection);
          const visiblePosition = editor.getScrolledVisiblePosition(position);
          const editorRect = editor.getDomNode()?.getBoundingClientRect();
          const containerRect = containerRef.current?.getBoundingClientRect();
          const containerHeight = containerRect?.height ?? window.innerHeight;
          const anchorY = (editorRect?.top ?? 0) + (visiblePosition?.top ?? 0) + (visiblePosition?.height ?? 18) - (containerRect?.top ?? 0);
          // Inline chat belongs to the line, not the caret column. Anchor it to
          // the editor's leading edge and let it consume all available width.
          const x = INLINE_CHAT_MARGIN;
          const y = Math.min(Math.max(INLINE_CHAT_MARGIN, anchorY + 8), Math.max(INLINE_CHAT_MARGIN, containerHeight - 360));

          setDefinitionMenu(null);
          setInlineChat({
            position: { x, y },
            context: {
              filePath: tab.path,
              language: getEditorLanguage(tab.path),
              fileContent: model.getValue(),
              selection: {
                text: selectedText,
                startLine: selection.startLineNumber,
                startColumn: selection.startColumn,
                endLine: selection.endLineNumber,
                endColumn: selection.endColumn,
              },
            },
          });
        },
      });
    }

    // Toggle blame display when user clicks on line numbers gutter
    editor.onMouseDown(async (e: any) => {
      if (await handleDefinitionLookup(editor, e)) return;
      const browserEvent = e?.event?.browserEvent;
      if (!browserEvent?.metaKey && !browserEvent?.ctrlKey) setDefinitionMenu(null);
      if (e.target && (e.target.type === 2 || e.target.type === 3 || e.target.type === 4)) {
        setShowBlame((prev) => !prev);
      }
    });

    setTimeout(() => {
      editor.layout();
      if (tab.line) {
        scrollToLine(editor, tab.line);
      }
    }, 50);
  };

  const getEditorLanguage = (filePath: string): string => {
    return shebangLanguage ?? getFileTypeDetails(filePath).language;
  };

  if (loading) {
    return (
      <div className="w-full h-full flex items-center justify-center font-mono text-xs text-[var(--text-muted)] bg-[var(--bg-app)]">
        <span>Loading file content...</span>
      </div>
    );
  }

  if (isImage) {
    if (imageLoadError) {
      return <UnsupportedFilePreview path={tab.path} fileName={tab.title ?? tab.path} sizeBytes={0} />;
    }
    if (imagePreview) {
      return (
        <ImageFilePreview
          path={tab.path}
          fileName={tab.title ?? tab.path}
          src={imagePreview.dataUrl}
          sizeBytes={imagePreview.sizeBytes}
        />
      );
    }
    // Neither set yet and not loading -- shouldn't happen (fetchImageContent
    // always sets one or the other before clearing `loading`), but falls
    // through to the unsupported card rather than rendering nothing.
    return <UnsupportedFilePreview path={tab.path} fileName={tab.title ?? tab.path} sizeBytes={0} />;
  }

  if (fileSafety.kind === "binary") {
    return <UnsupportedFilePreview path={tab.path} fileName={tab.title ?? tab.path} sizeBytes={fileSafety.sizeBytes} />;
  }

  return (
    <div ref={containerRef} className="w-full h-full relative bg-[var(--bg-app)]">
      {/* Floating Action Controls */}
      <div className="absolute top-2.5 right-6 z-10 flex items-center space-x-2">
        {tab.vfsTabId && (
          <span
            className="flex items-center space-x-1 px-2 py-0.5 rounded-md text-[10px] font-mono font-bold bg-[var(--accent-bg)] border border-[var(--accent-color)]/40 text-[var(--accent-color)] shadow-sm"
            title={`Virtual File System Document (${tab.vfsTabId})`}
          >
            <span>VFS</span>
          </span>
        )}

        {isMarkdown && (
          <button
            onClick={() => setMarkdownPreview((preview) => !preview)}
            className="flex items-center space-x-1 px-2.5 py-1 rounded-md text-[10px] font-mono font-bold border transition-all shadow-md cursor-pointer bg-[var(--bg-sidebar)] border border-[var(--border-color)] text-[var(--text-muted)] hover:text-[var(--text-light)] hover:border-[var(--border-active)]"
            title={markdownPreview ? "Edit Markdown source" : "Preview Markdown"}
          >
            {markdownPreview ? <FileCode2 size={10} /> : <Eye size={10} />}
            <span>{markdownPreview ? "Edit" : "Preview"}</span>
          </button>
        )}
        {/* Floating Git History Button - only for physical disk files */}
        {!tab.vfsTabId && (
          <button
            onClick={handleOpenFileHistory}
            className="bg-[var(--bg-sidebar)] border border-[var(--border-color)] text-[var(--text-muted)] hover:text-[var(--text-light)] hover:border-[var(--border-active)] p-1.5 rounded-md text-[10px] font-mono font-bold transition-all shadow-md cursor-pointer flex items-center space-x-1"
            title="Open Git History of this File"
          >
            <History size={10} />
            <span>History</span>
          </button>
        )}

        {/* Floating Git Blame Toggle Pill - only for physical disk files */}
        {!tab.vfsTabId && (
          <button
            onClick={() => setShowBlame(!showBlame)}
            className={`flex items-center space-x-1 px-2.5 py-1 rounded-md text-[10px] font-mono font-bold border transition-all shadow-md cursor-pointer ${
              showBlame
                ? "bg-[var(--accent-color)] border-[var(--accent-color)] text-[var(--color-primary-foreground)] font-semibold"
                : "bg-[var(--bg-sidebar)] border border-[var(--border-color)] text-[var(--text-muted)] hover:text-[var(--text-light)] hover:border-[var(--border-active)]"
            }`}
            title="Toggle Git Blame (or click line numbers)"
          >
            <GitBranch size={10} />
            <span>{showBlame ? "Blame: On" : "Blame"}</span>
          </button>
        )}

        {/* Reveal in Tree Button - only for physical disk files */}
        {!tab.vfsTabId && (
          <button
            onClick={() => revealFileInTree(tab.path)}
            className="bg-[var(--bg-sidebar)] border border-[var(--border-color)] text-[var(--text-muted)] hover:text-[var(--text-light)] hover:border-[var(--border-active)] p-1.5 rounded-md text-[10px] font-mono font-bold transition-all shadow-md cursor-pointer flex items-center space-x-1"
            title="Reveal in File Tree"
          >
            <TreePine size={10} />
            <span>Reveal</span>
          </button>
        )}
      </div>

      {definitionMenu && (
        <div
          className="absolute z-[9998] max-w-[calc(100%-24px)] rounded-lg border border-[var(--border-color)] bg-[var(--bg-sidebar)] shadow-2xl overflow-hidden font-mono"
          style={{ left: definitionMenu.x, top: definitionMenu.y, width: DEFINITION_MENU_WIDTH }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <div className="px-3 py-2 border-b border-[var(--border-color)] bg-[var(--color-surface-sunken)] flex items-center justify-between">
            <div className="flex items-center space-x-2 min-w-0">
              <FileSearch size={13} className="text-[var(--accent-color)] flex-shrink-0" />
              <span className="text-[10px] text-[var(--text-muted)] uppercase font-bold flex-shrink-0">Definitions</span>
              <span className="text-xs text-[var(--text-light)] truncate">{definitionMenu.symbol}</span>
            </div>
            <button
              onClick={() => setDefinitionMenu(null)}
              className="p-0.5 rounded text-[var(--text-muted)] hover:text-[var(--text-light)] hover:bg-[var(--bg-app)]"
              title="Close"
            >
              <X size={13} />
            </button>
          </div>

          <div className="max-h-[260px] overflow-y-auto">
            {definitionMenu.loading && (
              <div className="px-3 py-5 flex items-center justify-center space-x-2 text-[11px] text-[var(--text-muted)]">
                <Loader2 size={14} className="animate-spin text-[var(--accent-color)]" />
                <span>Searching workspace...</span>
              </div>
            )}

            {!definitionMenu.loading && definitionMenu.message && (
              <div className="px-3 py-5 text-center text-[11px] text-[var(--text-muted)]">
                {definitionMenu.message}
              </div>
            )}

            {!definitionMenu.loading && definitionMenu.results.map((candidate) => (
              <button
                key={`${candidate.path}:${candidate.line}:${candidate.content}`}
                onClick={() => openDefinitionCandidate(candidate)}
                className="w-full text-left px-3 py-2 border-b border-[var(--border-color)]/30 last:border-b-0 hover:bg-[var(--accent-bg)]/20 transition-colors"
                title={`${candidate.relativePath}:${candidate.line}`}
              >
                <div className="flex items-center justify-between space-x-2">
                  <span className="text-[11px] text-[var(--text-light)] truncate">{candidate.name}</span>
                  <span className="text-[9px] text-[var(--text-muted)] flex-shrink-0">Line {candidate.line}</span>
                </div>
                <div className="text-[10px] text-[var(--text-muted)] truncate mt-0.5">{candidate.relativePath}</div>
                <div className="text-[10px] text-[var(--text-normal)] truncate mt-1">{candidate.content}</div>
              </button>
            ))}
          </div>
        </div>
      )}

      {inlineChat && (
        <InlineChat
          sessionId={inlineChatSessionIdRef.current}
          context={inlineChat.context}
          position={inlineChat.position}
          onClose={() => {
            setInlineChat(null);
            window.setTimeout(() => editorRef.current?.focus(), 0);
          }}
        />
      )}

      {fileSafety.kind === "too_large" && !forceEditableLargeFile && (
        <div className="absolute top-0 left-0 right-0 z-20 flex items-center justify-between gap-3 px-4 py-2 bg-[var(--color-status-warning-bg)] border-b border-[var(--color-status-warning-border)] text-[var(--color-status-warning)] font-mono text-[11px]">
          <span>
            This file is {formatFileSize(fileSafety.sizeBytes)}, above the large-file threshold -- opened read-only.
          </span>
          <button
            type="button"
            onClick={() => setForceEditableLargeFile(true)}
            className="flex-shrink-0 px-2 py-1 rounded border border-[var(--color-status-warning-border)] hover:bg-[var(--color-status-warning-bg)]/60 cursor-pointer"
          >
            Load anyway (editable)
          </button>
        </div>
      )}

      {isMarkdown && markdownPreview ? (
        <div className="h-full overflow-auto px-6 py-5 pr-24 scrollbar-wider">
          <MarkdownRenderer content={fileContent} className="max-w-4xl mx-auto" />
        </div>
      ) : (
        <Editor
          height="100%"
          path={monacoModelUri}
          language={getEditorLanguage(tab.path)}
          theme="rusty-custom-theme"
          value={fileContent}
          onChange={handleEditorChange}
          onMount={handleEditorMount}
          keepCurrentModel
          options={createMonacoEditorOptions(editorFontSize, {
            minimap: { enabled: true },
            scrollBeyondLastLine: false,
            readOnly: fileSafety.kind === "too_large" && !forceEditableLargeFile,
            lineNumbers: (num: number) => {
              if (showBlame && blameData[num]) {
                const blame = blameData[num];
                return `${blame.author} (${blame.date}) │ ${num}`;
              }
              return String(num);
            },
            lineNumbersMinChars: showBlame ? maxBlameLength + 2 : 5,
            tabSize: 2,
          })}
        />
      )}
    </div>
  );
};
