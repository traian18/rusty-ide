import { memo, useMemo, useRef } from "react";
import { MarkdownRenderer } from "./MarkdownRenderer";
import type { ChatSearchMatch } from "./chatSearch";
import { MAX_STAGGER_MS, type FadeWordsOptions } from "./fadeWords";
import styles from "./StreamingMarkdown.module.css";

/** How long a word takes to settle. */
const FADE_MS = 650;
/** A block longer than this (a huge table or code listing) appears without the word fade. */
const MAX_FADE_BLOCK_CHARS = 6_000;

/** Where the batches of `text` still fading in start. Text that was replaced
 * rather than extended is shown as it is. */
export function useFadeArrivals(text: string): number[] {
  const stateRef = useRef<{ text: string; arrivals: Array<{ start: number; at: number }> }>({ text: "", arrivals: [] });
  const state = stateRef.current;
  const now = Date.now();
  if (!text.startsWith(state.text)) state.arrivals = [];
  else if (text.length > state.text.length) state.arrivals.push({ start: state.text.length, at: now });
  state.text = text;
  state.arrivals = state.arrivals.filter((arrival) => now - arrival.at < FADE_MS + MAX_STAGGER_MS);
  return state.arrivals.map((arrival) => arrival.start);
}

/** Splits Markdown at blank lines outside code fences. Lines indented after a
 * blank line (a list item's continuation, indented code) stay with their block. */
export function splitMarkdownBlocks(content: string): Array<{ start: number; text: string }> {
  const blocks: Array<{ start: number; text: string }> = [];
  let blockStart = -1;
  let blockEnd = 0;
  let fence: { char: string; length: number } | undefined;
  let sawBlank = false;
  let offset = 0;
  const close = () => {
    if (blockStart >= 0) blocks.push({ start: blockStart, text: content.slice(blockStart, blockEnd) });
    blockStart = -1;
  };
  for (const line of content.split("\n")) {
    const lineStart = offset;
    offset += line.length + 1;
    const marker = /^ {0,3}(`{3,}|~{3,})/.exec(line)?.[1];
    if (fence) {
      if (marker && marker[0] === fence.char && marker.length >= fence.length && !line.trim().slice(marker.length).trim()) fence = undefined;
      blockEnd = lineStart + line.length;
      continue;
    }
    if (!line.trim()) {
      sawBlank = true;
      continue;
    }
    if (sawBlank && !/^(?: {2,}|\t)/.test(line)) close();
    sawBlank = false;
    if (blockStart < 0) blockStart = lineStart;
    blockEnd = lineStart + line.length;
    if (marker) fence = { char: marker[0], length: marker.length };
  }
  close();
  return blocks;
}

const StreamingBlock = memo(function StreamingBlock({ content, fade, fadeKey, onLinkClick, searchMatches, activeSearchMatch }: {
  content: string;
  fade: boolean;
  /** The block's fading batches, joined, so an unchanged block keeps its props and is not parsed again. */
  fadeKey: string;
  onLinkClick?: (href: string, event: React.MouseEvent<HTMLAnchorElement>) => void;
  searchMatches?: ChatSearchMatch[];
  activeSearchMatch?: ChatSearchMatch;
}) {
  const fadeWords = useMemo<FadeWordsOptions | undefined>(() => fade
    ? { arrivals: fadeKey ? fadeKey.split(",").map(Number) : [], className: styles.word }
    : undefined, [fade, fadeKey]);
  return (
    <MarkdownRenderer
      content={content}
      onLinkClick={onLinkClick}
      fadeWords={fadeWords}
      {...(searchMatches ? { searchMatches, activeSearchMatch } : {})}
    />
  );
});

/** Markdown rendered while it streams in. Finished blocks are parsed once;
 * only the block still being written is parsed again on each update. New
 * words drift in instead of appearing at once. */
export const StreamingMarkdown = memo(function StreamingMarkdown({ content, onLinkClick, searchMatches = [], activeSearchMatch }: {
  content: string;
  onLinkClick?: (href: string, event: React.MouseEvent<HTMLAnchorElement>) => void;
  searchMatches?: ChatSearchMatch[];
  activeSearchMatch?: ChatSearchMatch;
}) {
  const arrivals = useFadeArrivals(content);
  const blocks = useMemo(() => splitMarkdownBlocks(content), [content]);
  return (
    <div className={styles.stream}>
      {blocks.map((block, index) => {
        const end = block.start + block.text.length;
        const local: number[] = [];
        for (const arrival of arrivals) {
          if (arrival >= end) break;
          const relative = Math.max(0, arrival - block.start);
          if (local[local.length - 1] !== relative) local.push(relative);
        }
        const matches = searchMatches
          .filter((match) => match.start < end && match.end > block.start)
          .map((match) => ({ ...match, start: match.start - block.start, end: match.end - block.start }));
        const active = matches.find((match) => match.occurrence === activeSearchMatch?.occurrence && match.messageId === activeSearchMatch?.messageId);
        return (
          <StreamingBlock
            key={index}
            content={block.text}
            fade={block.text.length <= MAX_FADE_BLOCK_CHARS}
            fadeKey={local.join(",")}
            onLinkClick={onLinkClick}
            {...(matches.length ? { searchMatches: matches, activeSearchMatch: active } : {})}
          />
        );
      })}
    </div>
  );
});
