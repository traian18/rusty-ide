// How the chat draws its messages: grouped clouds with a header per group,
// or (with turn layout) one balloon per agent turn.

import type React from "react";
import { useEffect, useState } from "react";
import { Check, Copy, FileText, Folder, Pin } from "lucide-react";
import type { ChatSearchMatch } from "./chatSearch";
import { AgentActivityCard } from "./SubagentActivityPanel";
import { ChatMessageContent } from "./ChatMessageContent";
import { AgentTurn, type TurnItem } from "./AgentTurn";
import { formatTimestamp, type ChatGroup } from "./chatGroups";
import type { Message, SubagentActivity } from "./chatTypes";
import styles from "./Chat.module.css";

export const EMPTY_SUBAGENTS: SubagentActivity[] = [];

/** What drawing a message needs from the chat around it. */
export interface MessageRenderContext {
  registerMessage: (messageId: string, element: HTMLDivElement | null) => void;
  activeMessageId?: string;
  onTogglePin?: (messageId: string, pinned: boolean) => void;
  onLinkClick: (href: string, event: React.MouseEvent<HTMLAnchorElement>) => void;
  /** The last message, while the model is still writing it. */
  streamingAnswerId?: string;
  liveMarkdown: boolean;
  /** Present only while there are search matches to highlight. */
  search?: { matchesByMessage: Map<string, ChatSearchMatch[]>; active?: ChatSearchMatch };
}

/** Who is streaming right now, for the activity cards. */
export interface LiveActivity {
  isStreaming: boolean;
  streamingMessageId: string | null;
  subagents: SubagentActivity[];
}

function isPinnable(message: Message): boolean {
  return message.role === "user" || message.role === "assistant";
}

function searchProps(messageId: string, search: MessageRenderContext["search"]) {
  if (!search) return {};
  return {
    searchMatches: search.matchesByMessage.get(messageId) ?? [],
    activeSearchMatch: search.active?.messageId === messageId ? search.active : undefined,
  };
}

/** How long "Copied" shows after a copy. */
const COPIED_MS = 1500;

/** Copies the message as it was written (its Markdown), and says so for a moment. */
function CopyButton({ message }: { message: Message }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), COPIED_MS);
    return () => clearTimeout(timer);
  }, [copied]);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(message.content);
      setCopied(true);
    } catch {
      // The clipboard can be refused (no focus, no permission); nothing was copied.
    }
  };
  return (
    <button
      type="button"
      className={`${styles.pinButton} ${copied ? styles.pinned : ""}`}
      aria-label={copied ? "Copied" : "Copy message"}
      title="Copy this message as Markdown"
      onClick={() => void copy()}
    >
      {copied ? <Check size={12} aria-hidden="true" /> : <Copy size={12} aria-hidden="true" />}
      {copied && <span>Copied</span>}
    </button>
  );
}

function MessageActions({ message, copyable, onTogglePin }: { message: Message; copyable: boolean; onTogglePin?: (messageId: string, pinned: boolean) => void }) {
  return (
    <div className={styles.messageActions} data-message-actions>
      {copyable && <CopyButton message={message} />}
      {onTogglePin && <PinButton message={message} onTogglePin={onTogglePin} />}
    </div>
  );
}

function PinButton({ message, onTogglePin }: { message: Message; onTogglePin: (messageId: string, pinned: boolean) => void }) {
  return (
    <button
      type="button"
      className={`${styles.pinButton} ${message.pinned ? styles.pinned : ""}`}
      aria-pressed={Boolean(message.pinned)}
      aria-label={message.pinned ? "Unpin message" : "Pin message"}
      title={message.pinned ? "Pinned: kept word for word when this chat is trimmed. Click to unpin." : "Pin: keep this word for word when this chat is trimmed"}
      onClick={() => onTogglePin(message.id, !message.pinned)}
    >
      <Pin size={12} aria-hidden="true" />
      {message.pinned && <span>Pinned</span>}
    </button>
  );
}

export function MessageBody({ message, context }: { message: Message; context: MessageRenderContext }) {
  const { registerMessage, activeMessageId, onTogglePin } = context;
  const streaming = message.role === "assistant" && message.id === context.streamingAnswerId;
  // An answer is copied once it is written; a pin works on questions and answers alike.
  const copyable = message.role === "assistant" && !streaming && message.content.trim().length > 0;
  const pinnable = Boolean(onTogglePin) && isPinnable(message);
  return (
    <div
      ref={(element) => registerMessage(message.id, element)}
      data-message-id={message.id}
      id={`chat-message-${message.id}`}
      className={`${styles.groupedItem} ${activeMessageId === message.id ? styles.activeMessage : ""}`}
    >
      {(copyable || pinnable) && <MessageActions message={message} copyable={copyable} onTogglePin={pinnable ? onTogglePin : undefined} />}
      <ChatMessageContent
        content={message.content}
        onLinkClick={context.onLinkClick}
        streaming={streaming}
        liveMarkdown={context.liveMarkdown}
        {...searchProps(message.id, context.search)}
      />
    </div>
  );
}

function ConsoleMessage({ message, phase, live }: { message: Message; phase?: string; live: LiveActivity }) {
  const isThisStreaming = live.isStreaming && live.streamingMessageId === message.id;
  const messageSubagents = live.streamingMessageId === message.id ? live.subagents : [];
  // Collapse unless it is the activity being streamed right now.
  const isFinalized = phase !== "activity" || !isThisStreaming;
  return (
    <AgentActivityCard
      content={message.content}
      activityEntries={message.activityEntries}
      isStreaming={isThisStreaming}
      subagents={messageSubagents}
      isFinalized={isFinalized}
    />
  );
}

/** The header label and styling of a group, by who wrote it and its phase. */
function groupStyle(isUser: boolean, phase: string | undefined): { label: string; className: string } {
  if (isUser) return { label: "Input Query", className: styles.userMessage };
  if (phase === "response") return { label: "Response", className: `${styles.agentMessage} ${styles.responseMessage}` };
  if (phase === "activity") return { label: "Activity Update", className: `${styles.agentMessage} ${styles.activityMessage}` };
  return { label: "Input Query", className: styles.agentMessage };
}

function Attachments({ attachments }: { attachments: NonNullable<Message["attachments"]> }) {
  return (
    <div className={styles.attachments}>
      <div className={styles.attachmentLabel}>Context Documents:</div>
      <div className={styles.attachmentList}>
        {attachments.map((att) => (
          <div key={att.path} className={styles.attachment}>
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
  );
}

function GroupedMessage({ message, first, context }: { message: Message; first: boolean; context: MessageRenderContext }) {
  const formattedTime = formatTimestamp(message.timestamp);
  return (
    <div className={styles.groupedItem}>
      {!first && (
        <div className={styles.groupedDivider} data-testid="grouped-divider" aria-hidden="true">
          <div className={styles.groupedDividerLine} />
          {formattedTime && <span className={styles.groupedTime}>{formattedTime}</span>}
          <div className={styles.groupedDividerLine} />
        </div>
      )}
      <MessageBody message={message} context={context} />
      {message.attachments && message.attachments.length > 0 && <Attachments attachments={message.attachments} />}
    </div>
  );
}

function MessageGroup({ group, context }: { group: Extract<ChatGroup, { type: "messages" }>; context: MessageRenderContext }) {
  const { isUser, messages } = group;
  const { label, className } = groupStyle(isUser, group.phase);
  const firstFormattedTime = formatTimestamp(messages[0]?.timestamp || "");
  return (
    <div className={`${styles.message} ${className}`}>
      <div className={styles.messageHeader}>
        <div className={styles.messageIdentity}>
          <span className={isUser ? styles.userTitle : styles.agentTitle}>[{isUser ? "USER" : "AGENT"}]</span>
          {firstFormattedTime && <span className={styles.time}>{firstFormattedTime}</span>}
        </div>
        <span className={styles.messageType}>{label}</span>
      </div>
      <div className={styles.content}>
        {messages.map((message, index) => (
          <GroupedMessage key={message.id} message={message} first={index === 0} context={context} />
        ))}
      </div>
    </div>
  );
}

export function renderChatGroup(group: ChatGroup, context: MessageRenderContext, live: LiveActivity): React.ReactElement {
  if (group.type === "console") return <ConsoleMessage key={group.message.id} message={group.message} phase={group.phase} live={live} />;
  return <MessageGroup key={group.id} group={group} context={context} />;
}

/** Agent turns: the thinking and tool work behind each answer stays in one small balloon that
 * folds away when the turn is done, leaving the final answer large. */
export function renderTurnItems(
  turnItems: TurnItem[],
  liveTurnIndex: number,
  options: { label: string; revealMessageId?: string; context: MessageRenderContext; live: LiveActivity },
): React.ReactElement[] {
  const { context, live } = options;
  const subagentsFor = (messages: Message[]) =>
    live.streamingMessageId && messages.some((message) => message.id === live.streamingMessageId) ? live.subagents : EMPTY_SUBAGENTS;
  return turnItems.map((item, index) => item.type === "user"
    ? renderChatGroup({ type: "messages", id: item.message.id, isUser: true, messages: [item.message], phase: item.message.phase || "query" }, context, live)
    : (
      <AgentTurn
        key={item.id}
        messages={item.messages}
        live={index === liveTurnIndex}
        label={options.label}
        subagents={subagentsFor(item.messages)}
        revealMessageId={options.revealMessageId}
        renderMessage={(message) => <MessageBody message={message} context={context} />}
      />
    ));
}
