/**
 * ResolveChatTabContent Component
 * 
 * Renders the interaction panel for resolving edge conflicts. It displays chat logs
 * (including user prompts, system announcements, and resolving-agent recommendations)
 * and holds the input form for sending messages.
 */

import React from "react";
import { Loader2, Send } from "lucide-react";
import { processResponse } from "../../../services/responseProcessingService";
import { TokenBadge, TokenUsageLike } from "../../ui/TokenBadge/TokenBadge";

interface ResolveChatTabContentProps {
  chatMessages: { role: string; content: string }[];
  chatInput: string;
  setChatInput: (val: string) => void;
  isResolving: boolean;
  runUsage?: TokenUsageLike | null;
  chatEndRef: React.RefObject<HTMLDivElement | null>;
  handleSendChat: () => void;
}

export const ResolveChatTabContent: React.FC<ResolveChatTabContentProps> = ({
  chatMessages,
  chatInput,
  setChatInput,
  isResolving,
  runUsage,
  chatEndRef,
  handleSendChat
}) => {
  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 p-4 space-y-3 overflow-y-auto text-xs">
        {chatMessages.map((msg, idx) => (
          <div
            key={idx}
            className={`flex flex-col rounded-xl p-3 w-full space-y-1 text-left ${
              msg.role === "user"
                ? "bg-[var(--color-status-danger-bg)] border border-[var(--color-status-danger-border)]"
                : "bg-[var(--bg-sidebar)]/60 border border-[var(--border-color)]/80"
            }`}
          >
            <span className={`font-mono text-[9px] uppercase font-bold ${
              msg.role === "user" ? "text-[var(--color-status-danger)]" : "text-[var(--color-secondary)]"
            }`}>
              {msg.role === "user" ? "You" : msg.role === "system" ? "System" : "Resolver"}
            </span>
            <div className="leading-relaxed whitespace-pre-wrap text-[var(--text-normal)]">
              {processResponse(msg.content)}
            </div>
          </div>
        ))}
        <div ref={chatEndRef} />
      </div>

      <div className="p-3 border-t border-[var(--border-color)] bg-[var(--bg-sidebar)]/20 space-y-2">
        {runUsage && (
          <div className="flex justify-end">
            <TokenBadge usage={runUsage} live={isResolving} />
          </div>
        )}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleSendChat();
          }}
          className="flex items-center space-x-2 bg-[var(--bg-app)] border border-[var(--border-color)] p-1.5 rounded-lg focus-within:border-[var(--color-status-danger-border)]"
        >
          <input
            type="text"
            placeholder="Describe how to resolve this conflict..."
            value={chatInput}
            onChange={(e) => setChatInput(e.target.value)}
            disabled={isResolving}
            className="flex-1 bg-transparent border-none outline-none text-xs px-2 py-1 focus:ring-0 text-[var(--text-normal)]"
          />
          <button
            type="submit"
            disabled={isResolving || !chatInput.trim()}
            className="bg-[var(--color-status-danger-solid)] hover:bg-[var(--color-status-danger-solid)] disabled:bg-[var(--bg-sidebar)] disabled:text-[var(--text-muted)] text-[var(--color-status-danger-solid-foreground)] text-xs font-mono font-bold px-3 py-1.5 rounded-md flex items-center space-x-1.5 transition-all cursor-pointer"
          >
            {isResolving ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />}
            <span>Send</span>
          </button>
        </form>
      </div>
    </div>
  );
};
