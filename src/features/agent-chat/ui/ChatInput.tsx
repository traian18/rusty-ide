import React from "react";
import { Send, X, FileText, Folder, Paperclip, Square, CircleHelp } from "lucide-react";
import styles from "./ChatInput.module.css";
import { PromptHistoryMenu } from "./PromptHistoryMenu";
import { CLOSED } from "../promptHistoryNav";
import { useChatInput, type ChatInputProps } from "./useChatInput";

export type { AgentQuestion } from "../../../../shared/agent-protocol";

export const ChatInput: React.FC<ChatInputProps> = (props) => {
  const model = useChatInput(props);
  const { value, placeholder = "Ask or prompt changes...", disabled = false, isStreaming = false, onStop, agentQuestion } = props;
  const { rootPath, attachments, showSuggestions, suggestions, selectedIndex, promptMenu, setPromptMenu, promptsOldestFirst, textareaRef, suggestionsRef, pickPrompt, handleKeyDown, handleInputChange, insertSuggestion, handleAddAttachment, handleAddFolderAttachment, handleRemoveAttachment, handleSend, answerQuestion } = model;
  return (
    <div className={`chat-typography-scope ${styles.composer} w-full flex flex-col relative bg-[var(--color-surface-sunken)] border border-[var(--color-border-subtle)] rounded shadow-sm focus-within:border-[var(--color-border-focus)] transition-colors`}>
      {/* 1. Autocomplete Dropdown */}
      {showSuggestions && suggestions.length > 0 && (
        <div
          ref={suggestionsRef}
          className="absolute left-0 bottom-full mb-1 z-[150] w-full max-h-48 overflow-y-auto bg-[var(--bg-sidebar)] border border-[var(--border-color)] rounded-lg shadow-xl py-1 font-mono animate-in fade-in slide-in-from-bottom-2 duration-150"
        >
          <div className="px-3 py-1 border-b border-[var(--border-color)]/40 text-[length:var(--font-size-chat-xs)] font-mono text-[var(--text-muted)] uppercase tracking-wider">
            Autolink Files
          </div>
          {suggestions.map((item, idx) => (
            <button
              key={item.path}
              onClick={() => insertSuggestion(item)}
              className={`w-full text-left px-3 py-1.5 flex items-center justify-between text-[length:var(--font-size-chat-md)] transition-colors cursor-pointer ${
                idx === selectedIndex
                  ? "bg-[var(--accent-bg)] text-[var(--text-light)]"
                  : "text-[var(--text-normal)] hover:bg-[var(--accent-bg)]/40"
              }`}
            >
              <span className="flex items-center space-x-2 min-w-0">
                {item.isDir ? (
                  <Folder size={12} className="text-[var(--color-secondary)] flex-shrink-0" />
                ) : (
                  <FileText size={12} className="text-[var(--color-fg-muted)] flex-shrink-0" />
                )}
                <span className="truncate">{item.name}</span>
              </span>
              <span className="text-[length:var(--font-size-chat-xs)] font-mono text-[var(--text-muted)] ml-2 truncate max-w-[120px]">
                {rootPath ? item.path.replace(`${rootPath}/`, "") : ""}
              </span>
            </button>
          ))}
        </div>
      )}

      {/* 2. Attachments Preview Drawer */}
      {agentQuestion && (
        <div className="mx-3 mt-3 rounded-lg border border-[var(--color-status-info-border)] bg-[var(--color-status-info-bg)] overflow-hidden">
          <div className="flex items-center gap-2 px-3 py-2 border-b border-[var(--color-status-info-border)] text-[var(--color-status-info)]">
            <CircleHelp size={14} className="text-[var(--color-status-info)] flex-shrink-0" />
            <span className="text-[length:var(--font-size-chat-xs)] font-mono uppercase tracking-wider font-semibold">Agent needs your decision</span>
          </div>
          <div className="px-3 pt-2.5 pb-3">
            <p className="text-[length:var(--font-size-chat-md)] text-[var(--text-light)] leading-relaxed">{agentQuestion.question}</p>
            {agentQuestion.options.length > 0 && (
              <div className="mt-2 grid gap-1.5">
                {agentQuestion.options.map((option, index) => (
                  <button
                    key={`${option.label}-${index}`}
                    type="button"
                    onClick={() => answerQuestion(option.label)}
                    className="w-full text-left rounded border border-[var(--color-border-default)] bg-[var(--color-surface-input)] px-2.5 py-2 hover:border-[var(--color-status-info)] hover:bg-[var(--color-interaction-hover)] transition-colors cursor-pointer"
                  >
                    <div className="text-[length:var(--font-size-chat-sm)] text-[var(--text-light)] font-medium">{option.label}</div>
                    {option.description && <div className="mt-0.5 text-[length:var(--font-size-chat-xs)] text-[var(--text-muted)]">{option.description}</div>}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {attachments.length > 0 && (
        <div className="flex flex-wrap gap-1.5 px-3 pt-3 pb-2 border-b border-[var(--color-border-subtle)] bg-[var(--color-log-header)]">
          {attachments.map((att) => (
            <div
              key={att.path}
              className="flex items-center space-x-1.5 px-2 py-0.5 rounded bg-[var(--color-surface-elevated)] border border-[var(--color-border-subtle)] text-[length:var(--font-size-chat-xs)] font-mono text-[var(--color-fg-strong)]"
            >
              {att.isDir ? (
                <Folder size={10} className="text-[var(--color-status-success)]" />
              ) : (
                <Paperclip size={10} className="text-[var(--accent-color)]" />
              )}
              <span className="truncate max-w-[150px]">{att.name}</span>
              <button
                onClick={() => handleRemoveAttachment(att.path)}
                className="text-[var(--text-muted)] hover:text-[var(--color-status-danger)] transition-colors p-0.5 rounded-full"
              >
                <X size={10} />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* 2b. Recent prompts (up arrow) */}
      {promptMenu.open && promptsOldestFirst.length > 0 && !disabled && !agentQuestion && (
        <PromptHistoryMenu
          prompts={promptsOldestFirst}
          selectedIndex={Math.min(promptMenu.index, promptsOldestFirst.length - 1)}
          onPick={pickPrompt}
          onHover={(index) => setPromptMenu({ open: true, index })}
        />
      )}

      {/* 3. Text Area Input */}
      <div className="px-2.5 py-1.5">
        <textarea
          ref={textareaRef}
          value={value}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          onBlur={() => setPromptMenu(CLOSED)}
          placeholder={agentQuestion ? "Type a different answer, then press Enter..." : placeholder}
          disabled={disabled && !agentQuestion}
          className="w-full bg-transparent border-none outline-none py-0.5 text-[length:var(--font-size-chat-md)] text-[var(--text-light)] placeholder-[var(--text-muted)] resize-none font-sans leading-relaxed min-h-[28px] select-text focus:ring-0 focus:outline-none"
          rows={1}
          style={{ height: "auto", maxHeight: "200px" }}
        />
      </div>

      {/* 4. Controls Footer Row */}
      <div className="flex items-center justify-between px-2.5 py-1.5 bg-[var(--color-surface-sunken)] border-t border-[var(--color-border-subtle)] text-[length:var(--font-size-chat-xs)] font-mono text-[var(--color-fg-muted)] select-none rounded-b">
        <div className="flex items-center space-x-1.5">
          {/* Upload File Button */}
          <button
            type="button"
            onClick={handleAddAttachment}
            disabled={disabled}
            className="flex items-center space-x-1 px-2 py-0.5 rounded bg-[var(--color-surface-app)] border border-[var(--color-border-subtle)] hover:text-[var(--text-light)] hover:border-[var(--color-border-focus)] transition-all cursor-pointer text-[length:var(--font-size-chat-xs)] text-[var(--text-normal)]"
            title="Attach file to prompt context (any file on disk)"
          >
            <Paperclip size={11} className="text-[var(--accent-color)]" />
            <span>Add Context</span>
          </button>

          {/* Upload Folder Button */}
          <button
            type="button"
            onClick={handleAddFolderAttachment}
            disabled={disabled}
            className="flex items-center space-x-1 px-1.5 py-0.5 rounded bg-[var(--color-surface-app)] border border-[var(--color-border-subtle)] hover:text-[var(--text-light)] hover:border-[var(--color-border-focus)] transition-all cursor-pointer text-[length:var(--font-size-chat-xs)] text-[var(--text-muted)] hover:text-[var(--text-normal)]"
            title="Attach folder to prompt context (any folder on disk)"
          >
            <Folder size={11} className="text-[var(--color-status-success)]" />
            <span className="hidden sm:inline">Folder</span>
          </button>

          <span className="text-[length:var(--font-size-chat-xs)] text-[var(--text-muted)]/60 font-light hidden xs:inline">
            Use @ for workspace files, or Add Context for any file
          </span>
        </div>

        <div className="flex items-center space-x-2">
          <span className="text-[length:var(--font-size-chat-xs)] text-[var(--text-muted)]/60 hidden md:inline">
            Enter to submit, Shift+Enter for new line
          </span>

          {/* Send or Stop Button */}
          {agentQuestion ? (
            <>
              <button
                type="button"
                onClick={() => answerQuestion(value)}
                disabled={!value.trim()}
                className="flex items-center space-x-1.5 px-2.5 py-1 rounded bg-[var(--color-primary)] disabled:opacity-40 text-[var(--color-primary-foreground)] font-semibold transition-all cursor-pointer shadow-sm text-[length:var(--font-size-chat-xs)]"
              >
                <Send size={9} />
                <span>ANSWER</span>
              </button>
              {isStreaming && onStop && (
                <button
                  type="button"
                  onClick={onStop}
                  className="flex items-center space-x-1.5 px-2.5 py-1 rounded bg-[var(--color-status-danger-solid)] hover:bg-[var(--color-status-danger-solid)] text-[var(--color-status-danger-solid-foreground)] font-semibold transition-all cursor-pointer shadow-sm text-[length:var(--font-size-chat-xs)]"
                >
                  <Square size={9} fill="currentColor" />
                  <span>STOP</span>
                </button>
              )}
            </>
          ) : isStreaming && onStop ? (
            <button
              type="button"
              onClick={onStop}
              className="flex items-center space-x-1.5 px-2.5 py-1 rounded bg-[var(--color-status-danger-solid)] hover:bg-[var(--color-status-danger-solid)] text-[var(--color-status-danger-solid-foreground)] font-semibold transition-all cursor-pointer shadow-sm animate-pulse text-[length:var(--font-size-chat-xs)]"
            >
              <Square size={9} fill="currentColor" />
              <span>STOP</span>
            </button>
          ) : (
            <button
              type="button"
              onClick={handleSend}
              disabled={disabled || (!value.trim() && attachments.length === 0)}
              className="flex items-center space-x-1.5 px-2.5 py-1 rounded bg-[var(--accent-color)] disabled:opacity-40 disabled:hover:bg-[var(--accent-color)] text-[var(--color-primary-foreground)] hover:bg-[var(--accent-color)]/80 font-semibold transition-all cursor-pointer shadow-sm text-[length:var(--font-size-chat-xs)]"
            >
              <Send size={9} />
              <span>PROMPT</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
