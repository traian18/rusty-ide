// Which message the reader is looking at: the one nearest the middle of the
// scroller, measured at most once a frame and over a bounded window.

import { useCallback, useEffect, useRef } from "react";
import { cancelFrame, now, type ChatViewport, type PerformanceListener } from "./chatViewport";
import type { ChatPerformanceMetrics, Message } from "./chatTypes";

const SCAN_WINDOW = 64;

/** The messages around the scroll position, plus those the observer reports.
 * IntersectionObserver updates asynchronously, so the current scroll window
 * is included too: a fast scroll cannot measure a stale observer set. */
function visibilityCandidates(container: HTMLElement, messageIds: string[], inView: Set<string>): Set<string> {
  const maxScrollTop = Math.max(1, container.scrollHeight - container.clientHeight);
  const scrollProgress = Math.max(0, Math.min(1, container.scrollTop / maxScrollTop));
  const lastIndex = Math.max(0, messageIds.length - 1);
  const center = Math.max(0, Math.min(messageIds.length - 1, Math.round(scrollProgress * lastIndex)));
  const start = Math.max(0, Math.min(Math.max(0, messageIds.length - SCAN_WINDOW), center - SCAN_WINDOW / 2));
  const candidates = new Set(messageIds.slice(start, start + SCAN_WINDOW));
  for (const messageId of inView) candidates.add(messageId);
  return candidates;
}

/** The candidate whose middle is nearest the middle of the scroller. */
function nearestToCenter(
  container: HTMLElement,
  candidates: Set<string>,
  elements: Map<string, HTMLDivElement>,
  metrics: ChatPerformanceMetrics,
): string | undefined {
  const viewportCenter = container.getBoundingClientRect().top + container.clientHeight / 2;
  let nearestId: string | undefined;
  let nearestDistance = Number.POSITIVE_INFINITY;
  for (const messageId of candidates) {
    const element = elements.get(messageId);
    if (!element) continue;
    metrics.geometryReads += 1;
    const rect = element.getBoundingClientRect();
    const distance = Math.abs(rect.top + rect.height / 2 - viewportCenter);
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearestId = messageId;
    }
  }
  return nearestId;
}

/** Tracks mounted messages and reports the one in view whenever it changes. */
export function useMessageVisibility(
  viewport: ChatViewport,
  messages: Message[],
  messageIds: string[],
  onVisibleMessageChange: ((messageId: string) => void) | undefined,
  onPerformanceMetrics: PerformanceListener,
) {
  const frame = useRef<number | null>(null);
  const lastVisible = useRef<string | undefined>(undefined);

  const registerMessage = useCallback((messageId: string, element: HTMLDivElement | null) => {
    if (element) viewport.messageElements.set(messageId, element);
    else {
      viewport.messageElements.delete(messageId);
      viewport.inView.delete(messageId);
    }
  }, []);

  useEffect(() => {
    const container = viewport.containerRef.current;
    if (!container || !onVisibleMessageChange || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        const messageId = (entry.target as HTMLElement).dataset.messageId;
        if (!messageId) continue;
        if (entry.isIntersecting) viewport.inView.add(messageId);
        else viewport.inView.delete(messageId);
      }
    }, { root: container, threshold: 0 });
    for (const element of viewport.messageElements.values()) observer.observe(element);
    return () => observer.disconnect();
  }, [messages, onVisibleMessageChange]);

  useEffect(() => () => cancelFrame(frame.current), []);

  const scheduleVisibilityUpdate = useCallback(() => {
    if (!onVisibleMessageChange || frame.current !== null) return;
    const runVisibilityUpdate = () => {
      frame.current = null;
      const container = viewport.containerRef.current;
      if (!container) return;
      const startedAt = now();
      viewport.metrics.visibilityScans += 1;
      const candidates = visibilityCandidates(container, messageIds, viewport.inView);
      const nearestId = nearestToCenter(container, candidates, viewport.messageElements, viewport.metrics);
      viewport.metrics.visibilityDurationMs += now() - startedAt;
      if (nearestId && nearestId !== lastVisible.current) {
        lastVisible.current = nearestId;
        onVisibleMessageChange(nearestId);
      }
      onPerformanceMetrics?.({ ...viewport.metrics });
    };
    if (typeof requestAnimationFrame === "function") {
      frame.current = requestAnimationFrame(runVisibilityUpdate);
    } else {
      frame.current = 1;
      queueMicrotask(runVisibilityUpdate);
    }
  }, [messageIds, onPerformanceMetrics, onVisibleMessageChange]);

  return { registerMessage, scheduleVisibilityUpdate };
}
