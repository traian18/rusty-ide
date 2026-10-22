// Jumping to an explicit target (a search result, a pinned query): scroll it
// into view once it is mounted, wait for the scroll to settle, then report
// it handled.

import { useEffect, useRef, useState } from "react";
import { now, type ChatViewport, type PerformanceListener } from "./chatViewport";

export interface ScrollTarget {
  messageId: string;
  token: number;
}

/** Re-checks for a target that has not mounted yet, one frame apart. */
const MOUNT_RETRIES = 20;
/** Frames to wait for a smooth scroll to settle. */
const SETTLE_FRAMES = 60;

/** The target sits inside the scroller, or its top lines up with the scroller's. */
function isAligned(rect: DOMRect, containerRect: DOMRect | undefined): boolean {
  if (!containerRect) return true;
  const inside = rect.top >= containerRect.top && rect.bottom <= containerRect.bottom;
  return inside || Math.abs(rect.top - containerRect.top) < 2;
}

/** The target did not move since the previous frame. */
function hasSettled(previous: DOMRect | undefined, rect: DOMRect): boolean {
  if (!previous) return false;
  return Math.abs(previous.top - rect.top) < 1 && Math.abs(previous.left - rect.left) < 1;
}

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)").matches);
}

export function useScrollTargetJump(
  viewport: ChatViewport,
  target: ScrollTarget | undefined,
  messageIds: string[],
  onPerformanceMetrics: PerformanceListener,
  onScrollTargetHandled: ((messageId: string) => void) | undefined,
): void {
  const lastHandledToken = useRef<number | undefined>(undefined);
  const attempts = useRef(0);
  const startedAt = useRef<number | null>(null);
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [retryVersion, setRetryVersion] = useState(0);

  useEffect(() => () => {
    if (retryTimer.current) clearTimeout(retryTimer.current);
  }, []);

  const waitForMount = () => {
    if (attempts.current >= MOUNT_RETRIES) {
      // Keep the token pending. The MutationObserver below will wake this effect
      // when a late-mounted message appears without a messages-array update.
      attempts.current = 0;
      return;
    }
    attempts.current += 1;
    retryTimer.current = setTimeout(() => {
      retryTimer.current = null;
      setRetryVersion((version) => version + 1);
    }, 16);
  };

  const reportLatency = () => {
    const started = startedAt.current;
    if (started === null) return;
    onPerformanceMetrics?.({ ...viewport.metrics, jumpLatencyMs: now() - started });
    startedAt.current = null;
  };

  const jumpTo = (element: HTMLDivElement, messageId: string) => {
    const reducedMotion = prefersReducedMotion();
    viewport.explicitNavigation = true;
    element.scrollIntoView({ behavior: reducedMotion ? "auto" : "smooth", block: "nearest" });
    let previousRect: DOMRect | undefined;
    let stableFrames = 0;
    const finishJump = () => {
      const rect = element.getBoundingClientRect();
      const aligned = isAligned(rect, viewport.containerRef.current?.getBoundingClientRect());
      stableFrames = hasSettled(previousRect, rect) ? stableFrames + 1 : 0;
      previousRect = rect;
      const moving = !aligned || stableFrames < 1;
      if (!reducedMotion && moving && attempts.current < SETTLE_FRAMES) {
        attempts.current += 1;
        requestAnimationFrame(finishJump);
        return;
      }
      attempts.current = 0;
      reportLatency();
      onScrollTargetHandled?.(messageId);
    };
    if (typeof requestAnimationFrame === "function") requestAnimationFrame(finishJump);
    else setTimeout(finishJump, reducedMotion ? 0 : 50);
  };

  useEffect(() => {
    if (!target || lastHandledToken.current === target.token) return;
    const element = viewport.messageElements.get(target.messageId);
    if (!element) {
      waitForMount();
      return;
    }
    attempts.current = 0;
    lastHandledToken.current = target.token;
    startedAt.current = now();
    jumpTo(element, target.messageId);
  }, [target, retryVersion, messageIds, onPerformanceMetrics, onScrollTargetHandled]);

  useEffect(() => {
    if (!target || typeof MutationObserver === "undefined") return;
    const container = viewport.containerRef.current;
    if (!container || viewport.messageElements.has(target.messageId)) return;
    const observer = new MutationObserver(() => {
      if (viewport.messageElements.has(target.messageId)) setRetryVersion((version) => version + 1);
    });
    observer.observe(container, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [target, retryVersion]);
}
