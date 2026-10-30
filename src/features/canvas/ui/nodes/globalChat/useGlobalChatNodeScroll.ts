/**
 * Prevents wheel events inside the scrollable content area from propagating
 * up to the React Flow viewport (which would otherwise zoom/pan the canvas).
 */

import { useEffect, type RefObject } from "react";

/**
 * Attaches a passive:false wheel listener that stops propagation,
 * allowing the inner scroll area to scroll without triggering canvas zoom.
 *
 * @param ref - A ref attached to the scrollable content container.
 */
export function useGlobalChatNodeScroll(
  ref: RefObject<HTMLDivElement | null>,
): void {
  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    const handleWheel = (e: WheelEvent): void => {
      e.stopPropagation();
    };

    element.addEventListener("wheel", handleWheel, { passive: false });
    return () => element.removeEventListener("wheel", handleWheel);
  }, [ref]);
}
