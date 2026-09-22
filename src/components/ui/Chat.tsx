import React, { useRef, useEffect, useLayoutEffect, useCallback, memo } from "react";
import { ChatMessageContent } from "./ChatMessageContent";
import { FileText, Folder, Loader2, Terminal } from "lucide-react";
import { AgentActivityCard } from "./SubagentActivityPanel";
import styles from "./Chat.module.css";
import { useWorkspaceStore } from "../../store";
import { ChatScrollFollow } from "./chatScrollFollow";

export interface Message {
  id: string;
  role: "user" | "assistant" | "system" | "tool-result" | "console";
  content: string;
  timestamp: string;
  attachments?: { path: string; name: string; isDir?: boolean }[];
}

export interface SubagentActivity {
  id: string;
  previousId?: string;
  agentId?: string;
  displayName?: string;
  description: string;
  subagentType?: string;
  isAggregation?: boolean;
  status: "queued" | "running" | "background" | "completed" | "steered" | "aborted" | "stopped" | "error";
  activity?: string;
  result?: string;
  error?: string;
  outputFile?: string;
  toolUses?: number;
  tokens?: string;
  turnCount?: number;
  maxTurns?: number;
  durationMs?: number;
  appendLog?: string;
  logs?: string[];
  startedAt?: string;
  updatedAt?: string;
  parentAgentId?: string;
  scope?: string[];
  excludedScope?: string[];
  expectedOutput?: "findings" | "review" | "recommendation";
  evidenceRequired?: boolean;
  timeoutMs?: number;
  queuePosition?: number;
  incorporated?: boolean;
}

interface ChatProps {
  messages: Message[];
  isStreaming?: boolean;
  streamingMessageId?: string | null;
  streamingLabel?: string;
  compact?: boolean;
  scrollKey?: string;
  subagents?: SubagentActivity[];
  /** Keep the view on new activity, but only while the reader is already at the bottom. */
  followLatest?: boolean;
}

export type ChatGroup =
  | { type: "console"; message: Message }
  | { type: "messages"; id: string; isUser: boolean; messages: Message[] };

export function groupChatMessages(messages: Message[]): ChatGroup[] {
  const groups: ChatGroup[] = [];

  for (const message of messages) {
    if (message.role === "console") {
      groups.push({ type: "console", message });
      continue;
    }

    const isUser = message.role === "user";
    const lastGroup = groups[groups.length - 1];

    if (lastGroup && lastGroup.type === "messages" && lastGroup.isUser === isUser) {
      lastGroup.messages.push(message);
    } else {
      groups.push({
        type: "messages",
        id: message.id,
        isUser,
        messages: [message],
      });
    }
  }

  return groups;
}

export function formatTimestamp(timestamp: string): string {
  if (!timestamp) return "";
  try {
    const date = new Date(timestamp);
    if (Number.isNaN(date.getTime())) return timestamp;
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  } catch {
    return timestamp;
  }
}

const EMPTY_SUBAGENTS: SubagentActivity[] = [];

export const Chat = memo(function Chat({ messages, isStreaming = false, streamingMessageId = null, streamingLabel = "Model is thinking…", compact = false, scrollKey, subagents = EMPTY_SUBAGENTS, followLatest = false }: ChatProps) {
  const rootPath = useWorkspaceStore((state) => state.rootPath);
  const openTab = useWorkspaceStore((state) => state.openTab);
  const handleLinkClick = useCallback((href: string, event: React.MouseEvent<HTMLAnchorElement>) => {
    // Only real web URLs belong in the browser. Relative and absolute paths
    // are workspace resources and should use the editor's file-tab flow.
    if (/^(https?:|mailto:|tel:|\/\/)/i.test(href) || href.startsWith("#")) return;
    event.preventDefault();
    const path = href.startsWith("/") || !rootPath
      ? href
      : `${rootPath.replace(/[\\/]$/, "")}/${href.replace(/^\.\//, "")}`;
    openTab({ type: "file", path, title: path.split(/[\\/]/).pop() || path });
  }, [rootPath, openTab]);
  const containerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const scrollFollowRef = useRef(new ChatScrollFollow());

  const handleScroll = () => {
    const container = containerRef.current;
    if (!container) return;

    // A small tolerance avoids stopping follow mode because of fractional pixel
    // rounding or the scrollbar itself.
    scrollFollowRef.current.update(container.scrollHeight - container.scrollTop - container.clientHeight);
    if (scrollKey) {
      localStorage.setItem(`chat_scroll_${scrollKey}`, String(container.scrollTop));
    }
  };

  useEffect(() => {
    if (scrollKey && containerRef.current) {
      const savedScroll = localStorage.getItem(`chat_scroll_${scrollKey}`);
      if (savedScroll) {
        containerRef.current.scrollTop = parseInt(savedScroll, 10);
      } else {
        containerRef.current.scrollTop = containerRef.current.scrollHeight;
      }
      handleScroll();
    }
  }, [scrollKey]);

  // Agent activity can grow every few seconds. Follow it only for readers who
  // are already viewing the latest activity; never pull someone away from an
  // earlier message they are reading.
  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container || !scrollFollowRef.current.shouldFollow(followLatest)) return;
    container.scrollTop = container.scrollHeight;
  }, [followLatest, messages, subagents, isStreaming]);

  // Tool output and Markdown blocks often change height after React commits
  // (collapsible activity, syntax highlighting, fonts). Follow their actual
  // rendered size while the reader is at the bottom; dependency-based effects
  // alone run too early and leave the view several screens above the live work.
  useEffect(() => {
    const container = containerRef.current;
    const content = contentRef.current;
    if (!followLatest || !container || !content || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      if (scrollFollowRef.current.shouldFollow(followLatest)) container.scrollTop = container.scrollHeight;
    });
    observer.observe(content);
    return () => observer.disconnect();
  }, [followLatest]);

  const renderGroup = (group: ChatGroup) => {
    if (group.type === "console") {
      const msg = group.message;
      const isThisStreaming = isStreaming && streamingMessageId === msg.id;
      const messageSubagents = streamingMessageId === msg.id ? subagents : [];
      return (
        <AgentActivityCard
          key={msg.id}
          content={msg.content}
          isStreaming={isThisStreaming}
          subagents={messageSubagents}
        />
      );
    }

    const { isUser, messages: groupMessages } = group;
    const title = isUser ? "USER" : "AGENT";
    const firstFormattedTime = formatTimestamp(groupMessages[0]?.timestamp || "");

    return (
      <div key={group.id} className={`${styles.message} ${isUser ? styles.userMessage : styles.agentMessage}`}>
        {/* Programmatic Header */}
        <div className={styles.messageHeader}>
          <div className={styles.messageIdentity}>
            <span className={isUser ? styles.userTitle : styles.agentTitle}>[{title}]</span>
            {firstFormattedTime && (
              <span className={styles.time}>{firstFormattedTime}</span>
            )}
          </div>
          <span className={styles.messageType}>
            {isUser ? "Input Query" : "Execution Result"}
          </span>
        </div>

        {/* Content Area */}
        <div className={styles.content}>
          {groupMessages.map((msg, index) => {
            const formattedTime = formatTimestamp(msg.timestamp);
            const isLatestMessageInChat = msg.id === messages[messages.length - 1]?.id;

            return (
              <div key={msg.id} className={styles.groupedItem}>
                {index > 0 && (
                  <div className={styles.groupedDivider} data-testid="grouped-divider" aria-hidden="true">
                    <div className={styles.groupedDividerLine} />
                    {formattedTime && (
                      <span className={styles.groupedTime}>{formattedTime}</span>
                    )}
                    <div className={styles.groupedDividerLine} />
                  </div>
                )}

                <div>
                  <ChatMessageContent
                    content={msg.content}
                    onLinkClick={handleLinkClick}
                    streaming={isStreaming && msg.role === "assistant" && isLatestMessageInChat}
                  />
                </div>

                {/* Attachments List */}
                {msg.attachments && msg.attachments.length > 0 && (
                  <div className={styles.attachments}>
                    <div className={styles.attachmentLabel}>Context Documents:</div>
                    <div className={styles.attachmentList}>
                      {msg.attachments.map((att) => (
                        <div
                          key={att.path}
                          className={styles.attachment}
                        >
                          {att.isDir ? (
                            <Folder size={11} className="text-[var(--color-status-warning)]" />
                          ) : (
                            <FileText size={11} className="text-[var(--color-status-info)]" />
                          )}
                          <span className={styles.attachmentName} title={att.name}>{att.name}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  const visibleMessages = messages.filter((message) =>
    message.role !== "console"
    || Boolean(message.content.trim())
    || (streamingMessageId === message.id && (isStreaming || subagents.length > 0))
  );

  return (
    <div
      ref={containerRef}
      onScroll={handleScroll}
      className={`chat-typography-scope ${styles.container} flex-1 overflow-y-auto ${compact ? "px-1" : "px-3"} py-2 scrollbar-wider min-h-0 min-w-0`}
    >
      <div ref={contentRef} className={`${styles.scrollContent} space-y-2`}>
      {visibleMessages.length === 0 ? (
        <div className={`${styles.empty} h-full flex flex-col items-center justify-center text-center select-none py-12`}>
          <Terminal size={32} className="text-[var(--accent-color)]/30 mb-3 animate-pulse" />
          <p>Agent interface initialized. Ready to receive commands.</p>
        </div>
      ) : (
        groupChatMessages(visibleMessages).map(renderGroup)
      )}
      {isStreaming && (
        <div className={`${styles.streaming} flex items-center gap-2 px-3 py-2`} aria-live="polite">
          <Loader2 size={14} className="animate-spin text-[var(--accent-color)]" />
          <span>{streamingLabel}</span>
        </div>
      )}
      </div>
    </div>
  );
});
