import React from "react";
import { History } from "lucide-react";

interface PromptHistoryMenuProps {
  /** The prompts as shown, oldest first (the newest is next to the box). */
  prompts: readonly string[];
  selectedIndex: number;
  onPick: (prompt: string) => void;
  onHover?: (index: number) => void;
}

/** The first line of a prompt, which is all a one-line row has room for. */
export const promptLabel = (prompt: string): string => prompt.trim().split(/\r?\n/)[0];

/** The "recent prompts" list above the chat box. */
export const PromptHistoryMenu: React.FC<PromptHistoryMenuProps> = ({ prompts, selectedIndex, onPick, onHover }) => (
  <div
    role="listbox"
    aria-label="Recent prompts"
    className="absolute left-0 bottom-full mb-1 z-[150] w-full max-h-56 overflow-y-auto bg-[var(--bg-sidebar)] border border-[var(--border-color)] rounded-lg shadow-xl py-1 font-mono animate-in fade-in slide-in-from-bottom-2 duration-150"
  >
    <div className="px-3 py-1 border-b border-[var(--border-color)]/40 flex items-center gap-1.5 text-[length:var(--font-size-chat-xs)] font-mono text-[var(--text-muted)] uppercase tracking-wider">
      <History size={11} aria-hidden />
      <span>Recent prompts</span>
      <span className="ml-auto normal-case tracking-normal opacity-70">↑↓ to move, Enter to use, Esc to close</span>
    </div>
    {prompts.map((prompt, index) => (
      <button
        id={`chat-prompt-history-${index}`}
        type="button"
        role="option"
        aria-selected={index === selectedIndex}
        key={`${index}-${prompt}`}
        title={prompt}
        // The box keeps focus: a click must not blur it, or the menu would close before it picked.
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => onPick(prompt)}
        onMouseEnter={() => onHover?.(index)}
        className={`w-full text-left px-3 py-1.5 text-[length:var(--font-size-chat-md)] transition-colors cursor-pointer ${index === selectedIndex ? "bg-[var(--accent-bg)] text-[var(--text-light)]" : "text-[var(--text-normal)] hover:bg-[var(--accent-bg)]/40"}`}
      >
        <span className="block truncate">{promptLabel(prompt)}</span>
      </button>
    ))}
  </div>
);
