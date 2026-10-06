import React, { useRef, useEffect, useLayoutEffect, useCallback, useMemo, memo, useState } from "react";
import type { ChatSearchMatch } from "./chatSearch";
import { FileText, Folder, Loader2, Terminal } from "lucide-react";
import { AgentActivityCard } from "./SubagentActivityPanel";
import styles from "./Chat.module.css";
import { useWorkspaceStore } from "../../store";
import { ChatScrollFollow } from "./chatScrollFollow";
import { ChatMessageContent } from "./ChatMessageContent";

export interface ActivityEntry {
  content: string;
  kind: "tool" | "update";
}

export interface Message {
  id: string;
  role: "user" | "assistant" | "system" | "tool-result" | "console";
  content: string;
  activityEntries?: ActivityEntry[];
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

export interface ChatPerformanceMetrics {
  scrollEvents: number;
  visibilityScans: number;
  geometryReads: number;
  visibilityDurationMs: number;
  followLatestWrites: number;
  jumpLatencyMs?: number;
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
  explicitScrollTarget?: { messageId: string; token: number };
  onScrollTargetHandled?: (messageId: string) => void;
  onVisibleMessageChange?: (messageId: string) => void;
  /** Opt-in diagnostics for repeatable scroll and jump measurements. */
  onPerformanceMetrics?: (metrics: ChatPerformanceMetrics) => void;
  activeMessageId?: string;
  searchMatches?: ChatSearchMatch[];
  activeSearchMatch?: ChatSearchMatch;
}
export type ChatGroup =
  | { type: "console"; message: Message; phase?: string }
  | { type: "messages"; id: string; isUser: boolean; messages: Message[]; phase?: string };

export function groupChatMessages(messages: Message[]): ChatGroup[] {
  const groups: ChatGroup[] = [];

  for (const message of messages) {
    const phase = (message as any).phase || "activity";  // Default for backward compat

    if (message.role === "console") {
      groups.push({ type: "console", message, phase });
      continue;
    }

    const isUser = message.role === "user";
    const lastGroup = groups[groups.length - 1];

    // NEW: Respect phase in grouping logic
    if (
      lastGroup &&
      lastGroup.type === "messages" &&
      lastGroup.isUser === isUser &&
      lastGroup.phase === phase  // MUST match phase
    ) {
      lastGroup.messages.push(message);
    } else {
      groups.push({
        type: "messages",
        id: message.id,
        isUser,
        messages: [message],
        phase,
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

export const Chat = memo(function Chat({ messages, isStreaming = false, streamingMessageId = null, streamingLabel = "Model is thinking…", compact = false, scrollKey, subagents = EMPTY_SUBAGENTS, followLatest = false, explicitScrollTarget, onScrollTargetHandled, onVisibleMessageChange, onPerformanceMetrics, activeMessageId, searchMatches = [], activeSearchMatch }: ChatProps) {
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
  const messageRefs = useRef(new Map<string, HTMLDivElement>());
  const visibleMessageIdsRef = useRef(new Set<string>());
  const explicitNavigationRef = useRef(false);
  const lastHandledTargetRef = useRef<number | undefined>(undefined);
  const lastVisibleMessageRef = useRef<string | undefined>(undefined);
  const visibilityFrameRef = useRef<number | null>(null);
  const persistenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const jumpRetryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const jumpAttemptsRef = useRef(0);
  const jumpStartedAtRef = useRef<number | null>(null);
  const followLatestFrameRef = useRef<number | null>(null);
  const metricsRef = useRef<ChatPerformanceMetrics>({ scrollEvents: 0, visibilityScans: 0, geometryReads: 0, visibilityDurationMs: 0, followLatestWrites: 0 });
  const [jumpRetryVersion, setJumpRetryVersion] = useState(0);
  const messageIds = useMemo(() => messages.map((message) => message.id), [messages]);

  const registerMessage = useCallback((messageId: string, element: HTMLDivElement | null) => {
    if (element) messageRefs.current.set(messageId, element);
    else {
      messageRefs.current.delete(messageId);
      visibleMessageIdsRef.current.delete(messageId);
    }
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !onVisibleMessageChange || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        const messageId = (entry.target as HTMLElement).dataset.messageId;
        if (!messageId) continue;
        if (entry.isIntersecting) visibleMessageIdsRef.current.add(messageId);
        else visibleMessageIdsRef.current.delete(messageId);
      }
    }, { root: container, threshold: 0 });
    for (const element of messageRefs.current.values()) observer.observe(element);
    return () => observer.disconnect();
  }, [messages, onVisibleMessageChange]);

  const scheduleVisibilityUpdate = useCallback(() => {
    if (!onVisibleMessageChange || visibilityFrameRef.current !== null) return;
    const runVisibilityUpdate = () => {
      visibilityFrameRef.current = null;
      const container = containerRef.current;
      if (!container) return;
      const startedAt = typeof performance !== "undefined" ? performance.now() : Date.now();
      metricsRef.current.visibilityScans += 1;
      const maxScrollTop = Math.max(1, container.scrollHeight - container.clientHeight);
      const scrollProgress = Math.max(0, Math.min(1, container.scrollTop / maxScrollTop));
      const fallbackCenter = Math.max(0, Math.min(messageIds.length - 1,
        Math.round(scrollProgress * Math.max(0, messageIds.length - 1))));
      const fallbackStart = Math.max(0, Math.min(
        Math.max(0, messageIds.length - 64),
        fallbackCenter - 32,
      ));
      // IntersectionObserver updates asynchronously. Include the current scroll
      // window as well so a fast scroll cannot measure a stale observer set.
      const candidateIds = new Set(messageIds.slice(fallbackStart, fallbackStart + 64));
      for (const messageId of visibleMessageIdsRef.current) candidateIds.add(messageId);
      const viewportCenter = container.getBoundingClientRect().top + container.clientHeight / 2;
      let nearestId: string | undefined;
      let nearestDistance = Number.POSITIVE_INFINITY;
      for (const messageId of candidateIds) {
        const element = messageRefs.current.get(messageId);
        if (!element) continue;
        metricsRef.current.geometryReads += 1;
        const rect = element.getBoundingClientRect();
        const distance = Math.abs(rect.top + rect.height / 2 - viewportCenter);
        if (distance < nearestDistance) {
          nearestDistance = distance;
          nearestId = messageId;
        }
      }
      metricsRef.current.visibilityDurationMs += (typeof performance !== "undefined" ? performance.now() : Date.now()) - startedAt;
      if (nearestId && nearestId !== lastVisibleMessageRef.current) {
        lastVisibleMessageRef.current = nearestId;
        onVisibleMessageChange(nearestId);
      }
      onPerformanceMetrics?.({ ...metricsRef.current });
    };
    if (typeof requestAnimationFrame === "function") {
      visibilityFrameRef.current = requestAnimationFrame(runVisibilityUpdate);
    } else {
      visibilityFrameRef.current = 1;
      queueMicrotask(runVisibilityUpdate);
    }
  }, [messageIds, onPerformanceMetrics, onVisibleMessageChange]);

  useEffect(() => () => {
    if (visibilityFrameRef.current !== null) {
      if (typeof cancelAnimationFrame === "function") cancelAnimationFrame(visibilityFrameRef.current);
      clearTimeout(visibilityFrameRef.current);
    }
    if (followLatestFrameRef.current !== null) {
      if (typeof cancelAnimationFrame === "function") cancelAnimationFrame(followLatestFrameRef.current);
      clearTimeout(followLatestFrameRef.current);
    }
    if (persistenceTimerRef.current) clearTimeout(persistenceTimerRef.current);
    if (jumpRetryTimerRef.current) clearTimeout(jumpRetryTimerRef.current);
  }, []);

  useEffect(() => {
    if (!explicitScrollTarget || lastHandledTargetRef.current === explicitScrollTarget.token) return;
    const target = messageRefs.current.get(explicitScrollTarget.messageId);
    if (!target) {
      if (jumpAttemptsRef.current < 20) {
        jumpAttemptsRef.current += 1;
        jumpRetryTimerRef.current = setTimeout(() => {
          jumpRetryTimerRef.current = null;
          setJumpRetryVersion((version) => version + 1);
        }, 16);
      } else {
        // Keep the token pending. A MutationObserver below will wake this effect
        // when a late-mounted message appears without a messages-array update.
        jumpAttemptsRef.current = 0;
      }
      return;
    }
    jumpAttemptsRef.current = 0;
    lastHandledTargetRef.current = explicitScrollTarget.token;
    jumpStartedAtRef.current = typeof performance !== "undefined" ? performance.now() : Date.now();
    const reducedMotion = typeof window !== "undefined"
      && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    explicitNavigationRef.current = true;
    target.scrollIntoView({ behavior: reducedMotion ? "auto" : "smooth", block: "nearest" });
    let previousRect: DOMRect | undefined;
    let stableFrames = 0;
    const finishJump = () => {
      const rect = target.getBoundingClientRect();
      const containerRect = containerRef.current?.getBoundingClientRect();
      const isAligned = !containerRect
        || (rect.top >= containerRect.top && rect.bottom <= containerRect.bottom)
        || Math.abs(rect.top - containerRect.top) < 2;
      const isStable = previousRect
        && Math.abs(previousRect.top - rect.top) < 1
        && Math.abs(previousRect.left - rect.left) < 1;
      stableFrames = isStable ? stableFrames + 1 : 0;
      previousRect = rect;
      if (!reducedMotion && (!isAligned || stableFrames < 1) && jumpAttemptsRef.current < 60) {
        jumpAttemptsRef.current += 1;
        requestAnimationFrame(finishJump);
        return;
      }
      jumpAttemptsRef.current = 0;
      const startedAt = jumpStartedAtRef.current;
      if (startedAt !== null) {
        const now = typeof performance !== "undefined" ? performance.now() : Date.now();
        onPerformanceMetrics?.({ ...metricsRef.current, jumpLatencyMs: now - startedAt });
        jumpStartedAtRef.current = null;
      }
      onScrollTargetHandled?.(explicitScrollTarget.messageId);
    };
    if (typeof requestAnimationFrame === "function") requestAnimationFrame(finishJump);
    else setTimeout(finishJump, reducedMotion ? 0 : 50);
  }, [explicitScrollTarget, jumpRetryVersion, messageIds, onPerformanceMetrics, onScrollTargetHandled]);

  const handleScroll = () => {
    const container = containerRef.current;
    if (!container) return;
    metricsRef.current.scrollEvents += 1;
    onPerformanceMetrics?.({ ...metricsRef.current });
    const distanceFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
    scrollFollowRef.current.update(distanceFromBottom);
    if (distanceFromBottom <= 24) explicitNavigationRef.current = false;
    if (scrollKey) {
      if (persistenceTimerRef.current) clearTimeout(persistenceTimerRef.current);
      persistenceTimerRef.current = setTimeout(() => {
        localStorage.setItem(`chat_scroll_${scrollKey}`, String(container.scrollTop));
        persistenceTimerRef.current = null;
      }, 100);
    }
    scheduleVisibilityUpdate();
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

  const scheduleFollowLatest = useCallback(() => {
    if (!followLatest || followLatestFrameRef.current !== null) return;
    const write = () => {
      followLatestFrameRef.current = null;
      const container = containerRef.current;
      if (!container || explicitNavigationRef.current || !scrollFollowRef.current.shouldFollow(followLatest)) return;
      const nextTop = container.scrollHeight;
      if (container.scrollTop !== nextTop) {
        container.scrollTop = nextTop;
        metricsRef.current.followLatestWrites += 1;
        onPerformanceMetrics?.({ ...metricsRef.current });
      }
    };
    if (typeof requestAnimationFrame === "function") followLatestFrameRef.current = requestAnimationFrame(write);
    else followLatestFrameRef.current = setTimeout(write, 0) as unknown as number;
  }, [followLatest, onPerformanceMetrics]);

  useLayoutEffect(() => {
    scheduleFollowLatest();
  }, [followLatest, messages, subagents, isStreaming, scheduleFollowLatest]);

  useEffect(() => {
    if (!explicitScrollTarget || typeof MutationObserver === "undefined") return;
    const container = containerRef.current;
    if (!container || messageRefs.current.has(explicitScrollTarget.messageId)) return;
    const observer = new MutationObserver(() => {
      if (messageRefs.current.has(explicitScrollTarget.messageId)) {
        setJumpRetryVersion((version) => version + 1);
      }
    });
    observer.observe(container, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [explicitScrollTarget, jumpRetryVersion]);

  // Dynamic Markdown and activity content is coalesced into the same frame path.
  useEffect(() => {
    const content = contentRef.current;
    if (!followLatest || !content || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => scheduleFollowLatest());
    observer.observe(content);
    return () => observer.disconnect();
  }, [followLatest, scheduleFollowLatest]);

  const searchMatchesByMessage = useMemo(() => {
    const matchesByMessage = new Map<string, ChatSearchMatch[]>();
    for (const match of searchMatches) {
      const matches = matchesByMessage.get(match.messageId);
      if (matches) matches.push(match);
      else matchesByMessage.set(match.messageId, [match]);
    }
    return matchesByMessage;
  }, [searchMatches]);

  const renderGroup = (group: ChatGroup) => {
    if (group.type === "console") {
      const msg = group.message;
      const isThisStreaming = isStreaming && streamingMessageId === msg.id;
      const messageSubagents = streamingMessageId === msg.id ? subagents : [];
      const isFinalized = group.phase !== "activity" || !isThisStreaming;  // NEW: collapse if not actively streaming
      return (
        <AgentActivityCard
          key={msg.id}
          content={msg.content}
          activityEntries={msg.activityEntries}
          isStreaming={isThisStreaming}
          subagents={messageSubagents}
          isFinalized={isFinalized}  // NEW: pass to component
        />
      );
    }

    const { isUser, messages: groupMessages, phase } = group;
    const title = isUser ? "USER" : "AGENT";
    const firstFormattedTime = formatTimestamp(groupMessages[0]?.timestamp || "");

    // NEW: Phase-based message type label and styling
    let messageTypeLabel = "Input Query";
    let messageClassName = isUser ? styles.userMessage : styles.agentMessage;

    if (!isUser) {
      if (phase === "response") {
        messageTypeLabel = "Response";
        messageClassName = `${styles.agentMessage} ${styles.responseMessage}`;  // NEW CSS class
      } else if (phase === "activity") {
        messageTypeLabel = "Activity Update";
        messageClassName = `${styles.agentMessage} ${styles.activityMessage}`;  // NEW CSS class
      }
    }

    return (
      <div key={group.id} className={`${styles.message} ${messageClassName}`}>
        {/* Programmatic Header */}
        <div className={styles.messageHeader}>
          <div className={styles.messageIdentity}>
            <span className={isUser ? styles.userTitle : styles.agentTitle}>[{title}]</span>
            {firstFormattedTime && (
              <span className={styles.time}>{firstFormattedTime}</span>
            )}
          </div>
          <span className={styles.messageType}>
            {messageTypeLabel}  {/* Changed from hardcoded "Execution Result" */}
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

                <div
                  ref={(element) => registerMessage(msg.id, element)}
                  data-message-id={msg.id}
                  id={`chat-message-${msg.id}`}
                  className={`${activeMessageId === msg.id ? styles.activeMessage : ""}`}
                >
                  <ChatMessageContent
                    content={msg.content}
                    onLinkClick={handleLinkClick}
                    streaming={isStreaming && msg.role === "assistant" && isLatestMessageInChat}
                    {...(searchMatches.length > 0 ? {
                      searchMatches: searchMatchesByMessage.get(msg.id) ?? [],
                      activeSearchMatch: activeSearchMatch?.messageId === msg.id ? activeSearchMatch : undefined,
                    } : {})}
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

  const visibleMessages = useMemo(() => messages.filter((message) =>
    message.role !== "console"
    || Boolean(message.content.trim())
    || (streamingMessageId === message.id && (isStreaming || subagents.length > 0))
  ), [messages, streamingMessageId, isStreaming, subagents.length]);
  const messageGroups = useMemo(() => groupChatMessages(visibleMessages), [visibleMessages]);

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
        messageGroups.map(renderGroup)
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
