import React, { useState, useRef, useEffect, useMemo } from "react";
import type { AgentQuestion } from "../../../../shared/agent-protocol";
import { useWorkspaceStore } from "../../../store";
import { open as openDialog } from "../../../lib/platform/dialog";
import { searchService } from "../../explorer";
import { CLOSED, stepPromptMenu, type PromptMenuState } from "../promptHistoryNav";

export interface ChatInputProps {
  value: string;
  onChange: (val: string) => void;
  onSend: (attachments: { path: string; name: string; isDir?: boolean }[]) => void;
  placeholder?: string;
  disabled?: boolean;
  isStreaming?: boolean;
  onStop?: () => void;
  agentQuestion?: AgentQuestion | null;
  onAgentQuestionAnswer?: (answer: string) => void;
  /** The user's earlier prompts, newest first, offered when they press the up arrow. */
  promptHistory?: readonly string[];
}

export const NO_PROMPTS: readonly string[] = [];

export interface FileItem {
  name: string;
  path: string;
  isDir: boolean;
}

export function useChatInput(props: Pick<ChatInputProps, "value" | "onChange" | "onSend" | "disabled" | "agentQuestion" | "onAgentQuestionAnswer" | "promptHistory">) {
  const { value, onChange, onSend, disabled = false, agentQuestion, onAgentQuestionAnswer, promptHistory = NO_PROMPTS } = props;
  const fileTree = useWorkspaceStore((state) => state.fileTree);
  const rootPath = useWorkspaceStore((state) => state.rootPath);

  const [attachments, setAttachments] = useState<{ path: string; name: string; isDir?: boolean }[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [suggestions, setSuggestions] = useState<FileItem[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [suggestionTriggerIndex, setSuggestionTriggerIndex] = useState(-1);
  const [promptMenu, setPromptMenu] = useState<PromptMenuState>(CLOSED);
  // The menu lists the prompts oldest first, so the newest sits next to the box.
  const promptsOldestFirst = useMemo(() => [...promptHistory].reverse(), [promptHistory]);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const suggestionsRef = useRef<HTMLDivElement>(null);
  const autocompleteTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Flatten the file tree for autocompletion fallback
  const getFlatFiles = (): FileItem[] => {
    const list: FileItem[] = [];
    const recurse = (entries: any[]) => {
      for (const entry of entries) {
        list.push({
          name: entry.name,
          path: entry.path,
          isDir: !!entry.is_dir,
        });
        if (entry.children && entry.children.length > 0) {
          recurse(entry.children);
        }
      }
    };
    recurse(fileTree || []);
    return list;
  };

  // Auto-resize the textarea
  useEffect(() => {
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.style.height = "auto";
      textarea.style.height = `${Math.min(200, textarea.scrollHeight)}px`;
    }
  }, [value]);

  // Handle click outside suggestions box & clean timeouts
  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      if (suggestionsRef.current && !suggestionsRef.current.contains(e.target as Node)) {
        setShowSuggestions(false);
      }
      if (!(e.target as Element).closest?.('[aria-label="Recent prompts"]')) {
        setPromptMenu(CLOSED);
      }
    };
    document.addEventListener("mousedown", handleOutsideClick);
    return () => {
      document.removeEventListener("mousedown", handleOutsideClick);
      if (autocompleteTimeoutRef.current) {
        clearTimeout(autocompleteTimeoutRef.current);
      }
    };
  }, []);

  const searchWorkspaceFiles = async (query: string) => {
    if (!rootPath) {
      setShowSuggestions(false);
      return;
    }

    if (!query) {
      // Instant fallback for empty query
      const flat = getFlatFiles();
      const filtered = flat.slice(0, 10);
      if (filtered.length > 0) {
        setSuggestions(filtered);
        setShowSuggestions(true);
        setSelectedIndex(0);
      } else {
        setShowSuggestions(false);
      }
      return;
    }

    try {
      const results = await searchService.searchProject({
        rootDir: rootPath,
        query,
        matchCase: false,
        wholeWord: false,
        isRegex: false,
      });

      const fileMatches = results
        .filter((r) => !r.is_content_match) // only filenames
        .map((r) => ({
          name: r.name,
          path: r.path,
          isDir: false,
        }))
        .slice(0, 10);

      if (fileMatches.length > 0) {
        setSuggestions(fileMatches);
        setShowSuggestions(true);
        setSelectedIndex(0);
      } else {
        setShowSuggestions(false);
      }
    } catch (err) {
      console.error("Failed autocomplete search:", err);
      setShowSuggestions(false);
    }
  };

  const pickPrompt = (prompt: string) => {
    onChange(prompt);
    setPromptMenu(CLOSED);
    // Leave the caret after the prompt, ready to edit or send.
    setTimeout(() => {
      const textarea = textareaRef.current;
      if (textarea) {
        textarea.setSelectionRange(prompt.length, prompt.length);
        textarea.focus();
      }
    }, 0);
  };

  // Handle keydown for autocompletion suggestions and the recent-prompts menu
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (!(showSuggestions && suggestions.length > 0)) {
      const { selectionStart, selectionEnd } = e.currentTarget;
      const step = stepPromptMenu(
        promptMenu,
        { key: e.key, shiftKey: e.shiftKey, altKey: e.altKey, ctrlKey: e.ctrlKey, metaKey: e.metaKey, isComposing: e.nativeEvent.isComposing },
        { prompts: promptsOldestFirst, value, caretAtStart: selectionStart === 0 && selectionEnd === 0, disabled: disabled || Boolean(agentQuestion) },
      );
      setPromptMenu(step.state);
      if (step.handled) {
        e.preventDefault();
        if (step.pick !== undefined) pickPrompt(step.pick);
        return;
      }
    }

    if (showSuggestions && suggestions.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((prev) => (prev + 1) % suggestions.length);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex((prev) => (prev - 1 + suggestions.length) % suggestions.length);
      } else if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        insertSuggestion(suggestions[selectedIndex]);
      } else if (e.key === "Escape") {
        e.preventDefault();
        setShowSuggestions(false);
      }
    } else if (agentQuestion) {
      if (e.key === "Enter" && !e.shiftKey && value.trim()) {
        e.preventDefault();
        onAgentQuestionAnswer?.(value.trim());
        onChange("");
      }
    } else {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const text = e.target.value;
    onChange(text);
    setPromptMenu(CLOSED);

    const selectionStart = e.target.selectionStart;
    const beforeCursor = text.substring(0, selectionStart);

    // Check if user has typed `@` followed by any non-whitespace characters
    const atMatch = beforeCursor.match(/@([^\s@]*)$/);

    if (atMatch) {
      const query = atMatch[1].toLowerCase();
      const triggerIdx = selectionStart - atMatch[0].length;
      setSuggestionTriggerIndex(triggerIdx);

      if (autocompleteTimeoutRef.current) {
        clearTimeout(autocompleteTimeoutRef.current);
      }

      autocompleteTimeoutRef.current = setTimeout(() => {
        searchWorkspaceFiles(query);
      }, 150);
    } else {
      setShowSuggestions(false);
    }
  };

  const insertSuggestion = (item: FileItem) => {
    const text = value;
    const startPart = text.substring(0, suggestionTriggerIndex);
    // Use relative path if possible, or just the file name
    const relativePath = rootPath ? item.path.replace(`${rootPath}/`, "") : item.name;
    const completedText =
      `${startPart}@${relativePath} ` + text.substring(textareaRef.current?.selectionStart || 0);

    onChange(completedText);
    setShowSuggestions(false);

    // Reposition cursor
    setTimeout(() => {
      if (textareaRef.current) {
        const cursorPosition = startPart.length + relativePath.length + 2; // +2 for @ and space
        textareaRef.current.setSelectionRange(cursorPosition, cursorPosition);
        textareaRef.current.focus();
      }
    }, 10);
  };

  const handleAddAttachment = async () => {
    try {
      const selected = await openDialog({
        multiple: true,
        directory: false,
        title: "Attach Context Document/File",
      });

      if (selected) {
        const paths = Array.isArray(selected) ? selected : [selected];
        const newAttachments = paths.map((p) => {
          const name = p.split("/").pop() || p;
          return { path: p, name, isDir: false };
        });
        setAttachments((prev) => {
          // Avoid duplicates
          const filtered = newAttachments.filter((n) => !prev.some((p) => p.path === n.path));
          return [...prev, ...filtered];
        });
      }
    } catch (err) {
      console.error("Failed to pick files:", err);
    }
  };

  const handleAddFolderAttachment = async () => {
    try {
      const selected = await openDialog({
        multiple: false,
        directory: true,
        title: "Attach Context Folder",
      });

      if (selected && typeof selected === "string") {
        const name = selected.split("/").pop() || selected;
        setAttachments((prev) => {
          if (prev.some((p) => p.path === selected)) return prev;
          return [...prev, { path: selected, name, isDir: true }];
        });
      }
    } catch (err) {
      console.error("Failed to pick folder:", err);
    }
  };

  const handleRemoveAttachment = (path: string) => {
    setAttachments((prev) => prev.filter((a) => a.path !== path));
  };

  const handleSend = () => {
    if (!value.trim() && attachments.length === 0) return;
    onSend(attachments);
    setAttachments([]);
  };

  const answerQuestion = (answer: string) => {
    const normalized = answer.trim();
    if (!normalized) return;
    onAgentQuestionAnswer?.(normalized);
    onChange("");
  };


  return {
    fileTree,
    rootPath,
    attachments,
    setAttachments,
    showSuggestions,
    setShowSuggestions,
    suggestions,
    setSuggestions,
    selectedIndex,
    setSelectedIndex,
    suggestionTriggerIndex,
    setSuggestionTriggerIndex,
    promptMenu,
    setPromptMenu,
    promptsOldestFirst,
    textareaRef,
    suggestionsRef,
    autocompleteTimeoutRef,
    getFlatFiles,
    searchWorkspaceFiles,
    pickPrompt,
    handleKeyDown,
    handleInputChange,
    insertSuggestion,
    handleAddAttachment,
    handleAddFolderAttachment,
    handleRemoveAttachment,
    handleSend,
    answerQuestion,
  };
}
