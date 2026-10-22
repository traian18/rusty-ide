import { memo, useMemo } from "react";
import type { ChatSearchMatch } from "./chatSearch";
import { Loader2, Terminal } from "lucide-react";
import styles from "./Chat.module.css";
import { groupAgentTurns, type TurnItem } from "./AgentTurn";
import { groupChatMessages, isShownMessage } from "./chatGroups";
import { useScrollTargetJump } from "./chatJump";
import { useWorkspaceLinkClick } from "./chatLinks";
import type { ChatPerformanceMetrics, Message, SubagentActivity } from "./chatTypes";
import { useChatScroll, useChatViewport, useFollowLatest } from "./chatViewport";
import { useMessageVisibility } from "./chatVisibility";
import { EMPTY_SUBAGENTS, renderChatGroup, renderTurnItems, type LiveActivity, type MessageRenderContext } from "./ChatMessageGroup";

// The chat's message model and grouping live in their own modules; they are
// re-exported here for everything that imports them from the chat.
export type { ActivityEntry, ChatPerformanceMetrics, Message, SubagentActivity } from "./chatTypes";
export { formatTimestamp, groupChatMessages, type ChatGroup } from "./chatGroups";

function matchesByMessage(searchMatches: ChatSearchMatch[]): Map<string, ChatSearchMatch[]> {
  const byMessage = new Map<string, ChatSearchMatch[]>();
  for (const match of searchMatches) {
    const matches = byMessage.get(match.messageId);
    if (matches) matches.push(match);
    else byMessage.set(match.messageId, [match]);
  }
  return byMessage;
}

/** The turn the model is still working on, or -1. */
function liveTurnIndexOf(turnItems: TurnItem[], isStreaming: boolean): number {
  return isStreaming && turnItems[turnItems.length - 1]?.type === "turn" ? turnItems.length - 1 : -1;
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
  /** Shows a pin on user and assistant messages; pinned ones are kept word for word when a long chat is trimmed. */
  onTogglePin?: (messageId: string, pinned: boolean) => void;
  /** Agent turns: the thinking and tool work behind each answer stays in one small balloon that
   * folds away when the turn is done, leaving the final answer large. Streamed words fade in. */
  turnLayout?: boolean;
}

export const Chat = memo(function Chat({ messages, isStreaming = false, streamingMessageId = null, streamingLabel = "Model is thinking…", compact = false, scrollKey, subagents = EMPTY_SUBAGENTS, followLatest = false, explicitScrollTarget, onScrollTargetHandled, onVisibleMessageChange, onPerformanceMetrics, activeMessageId, searchMatches = [], activeSearchMatch, onTogglePin, turnLayout = false }: ChatProps) {
  const viewport = useChatViewport();
  const handleLinkClick = useWorkspaceLinkClick();
  const messageIds = useMemo(() => messages.map((message) => message.id), [messages]);
  const { registerMessage, scheduleVisibilityUpdate } = useMessageVisibility(viewport, messages, messageIds, onVisibleMessageChange, onPerformanceMetrics);
  useScrollTargetJump(viewport, explicitScrollTarget, messageIds, onPerformanceMetrics, onScrollTargetHandled);
  const handleScroll = useChatScroll(viewport, scrollKey, scheduleVisibilityUpdate, onPerformanceMetrics);
  useFollowLatest(viewport, { followLatest, messages, subagents, isStreaming }, onPerformanceMetrics);
  const searchMatchesByMessage = useMemo(() => matchesByMessage(searchMatches), [searchMatches]);

  const visibleMessages = useMemo(() => {
    const live = isStreaming || subagents.length > 0;
    return messages.filter((message) => isShownMessage(message, streamingMessageId, live));
  }, [messages, streamingMessageId, isStreaming, subagents.length]);
  const messageGroups = useMemo(() => turnLayout ? [] : groupChatMessages(visibleMessages), [turnLayout, visibleMessages]);
  const turnItems = useMemo(() => turnLayout ? groupAgentTurns(visibleMessages) : [], [turnLayout, visibleMessages]);
  const liveTurnIndex = liveTurnIndexOf(turnItems, isStreaming);

  const context: MessageRenderContext = {
    registerMessage,
    activeMessageId,
    onTogglePin,
    onLinkClick: handleLinkClick,
    streamingAnswerId: isStreaming ? messages[messages.length - 1]?.id : undefined,
    liveMarkdown: turnLayout,
    search: searchMatches.length > 0 ? { matchesByMessage: searchMatchesByMessage, active: activeSearchMatch } : undefined,
  };
  const live: LiveActivity = { isStreaming, streamingMessageId, subagents };
  const revealMessageId = explicitScrollTarget?.messageId ?? activeMessageId;

  return (
    <div
      ref={viewport.containerRef}
      onScroll={handleScroll}
      className={`chat-typography-scope ${styles.container} flex-1 overflow-y-auto ${compact ? "px-1" : "px-3"} py-2 scrollbar-wider min-h-0 min-w-0`}
    >
      <div ref={viewport.contentRef} className={`${styles.scrollContent} space-y-2`}>
      {visibleMessages.length === 0 ? (
        <div className={`${styles.empty} h-full flex flex-col items-center justify-center text-center select-none py-12`}>
          <Terminal size={32} className="text-[var(--accent-color)]/30 mb-3 animate-pulse" />
          <p>Agent interface initialized. Ready to receive commands.</p>
        </div>
      ) : turnLayout ? (
        renderTurnItems(turnItems, liveTurnIndex, { label: streamingLabel, revealMessageId, context, live })
      ) : (
        messageGroups.map((group) => renderChatGroup(group, context, live))
      )}
      {/* With turns, the live turn's balloon carries the status line. */}
      {isStreaming && liveTurnIndex < 0 && (
        <div className={`${styles.streaming} flex items-center gap-2 px-3 py-2`} aria-live="polite">
          <Loader2 size={14} className="animate-spin text-[var(--accent-color)]" />
          <span>{streamingLabel}</span>
        </div>
      )}
      </div>
    </div>
  );
});
