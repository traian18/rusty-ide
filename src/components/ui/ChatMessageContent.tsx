import { memo, useState } from "react";
import { MarkdownRenderer } from "./MarkdownRenderer";
import styles from "./Chat.module.css";

// Large or incomplete Markdown (especially tables) is expensive to parse on
// each streamed update. Keep the full saved response, but bound normal rendering.
export const CHAT_PREVIEW_CHARS = 16_000;

export const ChatMessageContent = memo(function ChatMessageContent({ content, streaming = false, onLinkClick }: {
  content: string;
  streaming?: boolean;
  onLinkClick?: (href: string, event: React.MouseEvent<HTMLAnchorElement>) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const large = content.length > CHAT_PREVIEW_CHARS;
  if (!streaming && !large) return <MarkdownRenderer content={content} onLinkClick={onLinkClick} />;
  const preview = large && !expanded ? content.slice(0, CHAT_PREVIEW_CHARS) : content;
  return <div>
    <pre className={styles.responseText}>{preview}</pre>
    {large && <button type="button" className={styles.responseToggle} onClick={() => setExpanded((value) => !value)}>
      {expanded ? "Show preview" : `Show full response as text (${content.length.toLocaleString()} characters)`}
    </button>}
  </div>;
});
