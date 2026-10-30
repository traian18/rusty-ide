/**
 * Custom hook for resizing the GlobalChatNode via a drag handle.
 *
 * Attaches mousemove/mouseup listeners on the document so the resize
 * remains responsive even when the cursor leaves the handle. Updates
 * the node dimensions in the Zustand store on every mouse move.
 */

import {
  useState,
  useRef,
  useCallback,
  useEffect,
  type MouseEvent as ReactMouseEvent,
} from "react";

interface UseGlobalChatNodeResizeOptions {
  /** The node id to update dimensions for. */
  id: string;
  /** The initial width from node data (fallback default). */
  initialWidth?: number;
  /** The initial height from node data (fallback default). */
  initialHeight?: number;
  /** Store action to persist dimension changes. */
  updateNode: (
    id: string,
    data: Partial<{ width: number; height: number }>,
  ) => void;
}

interface UseGlobalChatNodeResizeReturn {
  /** Current node width in pixels. */
  width: number;
  /** Current node height in pixels. */
  height: number;
  /** Call this from the resize handle's onMouseDown. */
  startResize: (e: ReactMouseEvent) => void;
}

export function useGlobalChatNodeResize({
  id,
  initialWidth = 384,
  initialHeight = 220,
  updateNode,
}: UseGlobalChatNodeResizeOptions): UseGlobalChatNodeResizeReturn {
  const [width, setWidth] = useState(initialWidth);
  const [height, setHeight] = useState(initialHeight);

  const isResizing = useRef(false);
  const startDimensions = useRef({ width: 0, height: 0, x: 0, y: 0 });

  /** Handles the mousemove event during a resize operation. */
  const handleResize = useCallback(
    (e: MouseEvent) => {
      if (!isResizing.current) return;

      const deltaX = e.clientX - startDimensions.current.x;
      const deltaY = e.clientY - startDimensions.current.y;

      const newWidth = Math.max(300, startDimensions.current.width + deltaX);
      const newHeight = Math.max(150, startDimensions.current.height + deltaY);

      setWidth(newWidth);
      setHeight(newHeight);
      updateNode(id, { width: newWidth, height: newHeight });
    },
    [id, updateNode],
  );

  /** Cleans up resize listeners and resets the resizing flag. */
  const stopResize = useCallback(() => {
    isResizing.current = false;
    document.removeEventListener("mousemove", handleResize);
    document.removeEventListener("mouseup", stopResize);
  }, [handleResize]);

  /** Initiates the resize operation on mouse down. */
  const startResize = useCallback(
    (e: ReactMouseEvent) => {
      e.preventDefault();
      e.stopPropagation();

      isResizing.current = true;
      startDimensions.current = {
        width,
        height,
        x: e.clientX,
        y: e.clientY,
      };

      document.addEventListener("mousemove", handleResize);
      document.addEventListener("mouseup", stopResize);
    },
    [width, height, handleResize, stopResize],
  );

  /** Cleanup on unmount to prevent orphan listeners. */
  useEffect(() => {
    return () => {
      document.removeEventListener("mousemove", handleResize);
      document.removeEventListener("mouseup", stopResize);
    };
  }, [handleResize, stopResize]);

  return { width, height, startResize };
}
