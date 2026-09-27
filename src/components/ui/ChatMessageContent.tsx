import { memo, useState } from "react";
import { MarkdownRenderer } from "./MarkdownRenderer";
import styles from "./Chat.module.css";
import { CHAT_RENDER_CHARS } from "../../config/chatLimits";

// Large or incomplete Markdown (especially tables) is expensive to parse on
// each streamed update. Keep the full saved response, but bound normal rendering.
export const CHAT_PREVIEW_CHARS = CHAT_RENDER_CHARS;

/** The latest `chars` of `content`, starting at a line boundary when one is near. */
function latestPart(content: string, chars: number): string {
  const tail = content.slice(-chars);
  const lineStart = tail.indexOf("\n");
  return lineStart >= 0 && lineStart < 500 ? tail.slice(lineStart + 1) : tail;
}

export const ChatMessageContent = memo(function ChatMessageContent({ content, streaming = false, onLinkClick }: {
  content: string;
  streaming?: boolean;
  onLinkClick?: (href: string, event: React.MouseEvent<HTMLAnchorElement>) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const large = content.length > CHAT_PREVIEW_CHARS;
  if (!streaming && !large) return <MarkdownRenderer content={content} onLinkClick={onLinkClick} />;
  if (streaming) {
    // Follow the live end of a long response instead of freezing on its start.
    return <div>
      {large && <p className={styles.responseNote}>
        Long response: {content.length.toLocaleString()} characters so far. Showing the latest part; the full response is kept.
      </p>}
      <pre className={styles.responseText}>{large ? latestPart(content, CHAT_PREVIEW_CHARS) : content}</pre>
    </div>;
  }
  const preview = expanded ? content : content.slice(0, CHAT_PREVIEW_CHARS);
  return <div>
    <pre className={styles.responseText}>{preview}</pre>
    <button type="button" className={styles.responseToggle} onClick={() => setExpanded((value) => !value)}>
      {expanded ? "Show preview" : `Show full response as text (${content.length.toLocaleString()} characters)`}
    </button>
  </div>;
});
