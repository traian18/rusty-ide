// The chat's scroller: what its scrolling behaviours share, the reader's
// scroll position (remembered per chat), and following new activity while
// the reader is at the bottom.

import { createRef, useCallback, useEffect, useLayoutEffect, useRef, type RefObject } from "react";
import { ChatScrollFollow } from "./chatScrollFollow";
import type { ChatPerformanceMetrics, Message, SubagentActivity } from "./chatTypes";

/** Kept across renders and shared by the chat's scrolling hooks. */
export interface ChatViewport {
  containerRef: RefObject<HTMLDivElement | null>;
  contentRef: RefObject<HTMLDivElement | null>;
  /** Mounted message elements, by message id. */
  messageElements: Map<string, HTMLDivElement>;
  /** Messages the IntersectionObserver last reported in view. */
  inView: Set<string>;
  metrics: ChatPerformanceMetrics;
  follow: ChatScrollFollow;
  /** Set by a jump to an explicit target; follow-latest holds off until the reader is back at the bottom. */
  explicitNavigation: boolean;
}

export type PerformanceListener = ((metrics: ChatPerformanceMetrics) => void) | undefined;

export function useChatViewport(): ChatViewport {
  const viewport = useRef<ChatViewport | null>(null);
  viewport.current ??= {
    containerRef: createRef<HTMLDivElement>(),
    contentRef: createRef<HTMLDivElement>(),
    messageElements: new Map(),
    inView: new Set(),
    metrics: { scrollEvents: 0, visibilityScans: 0, geometryReads: 0, visibilityDurationMs: 0, followLatestWrites: 0 },
    follow: new ChatScrollFollow(),
    explicitNavigation: false,
  };
  return viewport.current;
}

export function now(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

/** Cancels a frame scheduled with requestAnimationFrame or its timer fallback. */
export function cancelFrame(id: number | null): void {
  if (id === null) return;
  if (typeof cancelAnimationFrame === "function") cancelAnimationFrame(id);
  clearTimeout(id);
}

/** The scroll handler: tracks whether the reader is at the bottom and saves the position under `scrollKey`. */
export function useChatScroll(viewport: ChatViewport, scrollKey: string | undefined, onScrolled: () => void, onPerformanceMetrics: PerformanceListener) {
  const persistenceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (persistenceTimer.current) clearTimeout(persistenceTimer.current);
  }, []);

  const savePosition = (container: HTMLDivElement, key: string) => {
    if (persistenceTimer.current) clearTimeout(persistenceTimer.current);
    persistenceTimer.current = setTimeout(() => {
      localStorage.setItem(`chat_scroll_${key}`, String(container.scrollTop));
      persistenceTimer.current = null;
    }, 100);
  };

  const handleScroll = () => {
    const container = viewport.containerRef.current;
    if (!container) return;
    viewport.metrics.scrollEvents += 1;
    onPerformanceMetrics?.({ ...viewport.metrics });
    const distanceFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
    viewport.follow.update(distanceFromBottom);
    if (distanceFromBottom <= 24) viewport.explicitNavigation = false;
    if (scrollKey) savePosition(container, scrollKey);
    onScrolled();
  };

  useEffect(() => {
    const container = viewport.containerRef.current;
    if (!scrollKey || !container) return;
    const savedScroll = localStorage.getItem(`chat_scroll_${scrollKey}`);
    container.scrollTop = savedScroll ? parseInt(savedScroll, 10) : container.scrollHeight;
    handleScroll();
  }, [scrollKey]);

  return handleScroll;
}

/** What may have grown the chat since the last frame. */
export interface FollowLatestChanges {
  followLatest: boolean;
  messages: Message[];
  subagents: SubagentActivity[];
  isStreaming: boolean;
}

/** Keeps the view on new activity, but only while the reader is already at the bottom. */
export function useFollowLatest(viewport: ChatViewport, changes: FollowLatestChanges, onPerformanceMetrics: PerformanceListener): void {
  const { followLatest, messages, subagents, isStreaming } = changes;
  const frame = useRef<number | null>(null);

  useEffect(() => () => cancelFrame(frame.current), []);

  const scheduleFollowLatest = useCallback(() => {
    if (!followLatest || frame.current !== null) return;
    const write = () => {
      frame.current = null;
      const container = viewport.containerRef.current;
      if (!container || viewport.explicitNavigation || !viewport.follow.shouldFollow(followLatest)) return;
      const nextTop = container.scrollHeight;
      if (container.scrollTop === nextTop) return;
      container.scrollTop = nextTop;
      viewport.metrics.followLatestWrites += 1;
      onPerformanceMetrics?.({ ...viewport.metrics });
    };
    if (typeof requestAnimationFrame === "function") frame.current = requestAnimationFrame(write);
    else frame.current = setTimeout(write, 0) as unknown as number;
  }, [followLatest, onPerformanceMetrics]);

  useLayoutEffect(() => {
    scheduleFollowLatest();
  }, [followLatest, messages, subagents, isStreaming, scheduleFollowLatest]);

  // Dynamic Markdown and activity content is coalesced into the same frame path.
  useEffect(() => {
    const content = viewport.contentRef.current;
    if (!followLatest || !content || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => scheduleFollowLatest());
    observer.observe(content);
    return () => observer.disconnect();
  }, [followLatest, scheduleFollowLatest]);
}
