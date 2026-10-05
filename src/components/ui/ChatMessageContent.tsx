import { memo, useState } from "react";
import { MarkdownRenderer } from "./MarkdownRenderer";
import type { ChatSearchMatch } from "./chatSearch";
import styles from "./Chat.module.css";
import { CHAT_RENDER_CHARS } from "../../config/chatLimits";

// Large or incomplete Markdown (especially tables) is expensive to parse on
// each streamed update. Keep the full saved response, but bound normal rendering.
export const CHAT_PREVIEW_CHARS = CHAT_RENDER_CHARS;

/** The latest `chars` of `content`, starting at a line boundary when one is near. */
function latestPart(content: string, chars: number): { text: string; offset: number } {
  const start = Math.max(0, content.length - chars);
  const tail = content.slice(start);
  const lineStart = tail.indexOf("\n");
  if (lineStart >= 0 && lineStart < 500) {
    return { text: tail.slice(lineStart + 1), offset: start + lineStart + 1 };
  }
  return { text: tail, offset: start };
}

export const ChatMessageContent = memo(function ChatMessageContent({ content, streaming = false, onLinkClick, searchMatches = [], activeSearchMatch }: {
  content: string;
  streaming?: boolean;
  onLinkClick?: (href: string, event: React.MouseEvent<HTMLAnchorElement>) => void;
  searchMatches?: ChatSearchMatch[];
  activeSearchMatch?: ChatSearchMatch;
}) {
  const [expanded, setExpanded] = useState(false);
  const large = content.length > CHAT_PREVIEW_CHARS;
  const visibleMatches = searchMatches.filter((match) => match.start < content.length && match.end > 0);
  const renderText = (text: string, offset = 0) => {
    const ranges = visibleMatches
      .map((match) => ({ ...match, start: Math.max(0, match.start - offset), end: Math.min(text.length, match.end - offset) }))
      .filter((match) => match.start < match.end)
      .sort((a, b) => a.start - b.start);
    if (!ranges.length) return text;
    const parts: React.ReactNode[] = [];
    let cursor = 0;
    ranges.forEach((match, index) => {
      if (match.start > cursor) parts.push(text.slice(cursor, match.start));
      parts.push(<mark key={`${match.messageId}-${match.occurrence}-${index}`} data-testid="chat-search-highlight" data-active={activeSearchMatch?.occurrence === match.occurrence ? "true" : "false"}>{text.slice(match.start, match.end)}</mark>);
      cursor = Math.max(cursor, match.end);
    });
    if (cursor < text.length) parts.push(text.slice(cursor));
    return parts;
  };
  if (!streaming && !large) return <MarkdownRenderer content={content} onLinkClick={onLinkClick} renderText={renderText} />;
  if (streaming) {
    // Follow the live end of a long response instead of freezing on its start.
    const visible = large ? latestPart(content, CHAT_PREVIEW_CHARS) : { text: content, offset: 0 };
    return <div>
      {large && <p className={styles.responseNote}>
        Long response: {content.length.toLocaleString()} characters so far. Showing the latest part; the full response is kept.
      </p>}
      <pre className={styles.responseText}>{renderText(visible.text, visible.offset)}</pre>
    </div>;
  }
  const preview = expanded ? { text: content, offset: 0 } : { text: content.slice(0, CHAT_PREVIEW_CHARS), offset: 0 };
  return <div>
    <pre className={styles.responseText}>{renderText(preview.text, preview.offset)}</pre>
    <button type="button" className={styles.responseToggle} onClick={() => setExpanded((value) => !value)}>
      {expanded ? "Show preview" : `Show full response as text (${content.length.toLocaleString()} characters)`}
    </button>
  </div>;
});
