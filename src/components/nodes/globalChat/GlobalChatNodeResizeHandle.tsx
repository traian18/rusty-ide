/**
 * A small drag handle rendered at the bottom-right corner of the node.
 *
 * Fires the onStartResize callback on mouse down so the parent hook
 * can begin tracking the resize gesture.
 */

import React from "react";
import { stopNodePropagation } from "./stopPropagation";

interface GlobalChatNodeResizeHandleProps {
  /** Callback that initiates resize (usually from useGlobalChatNodeResize). */
  onStartResize: (e: React.MouseEvent) => void;
}

export const GlobalChatNodeResizeHandle: React.FC<
  GlobalChatNodeResizeHandleProps
> = ({ onStartResize }) => {
  return (
    <div
      onMouseDown={onStartResize}
      onPointerDown={stopNodePropagation}
      className="nodrag absolute right-0 bottom-0 w-4 h-4 cursor-se-resize flex items-end justify-end p-0.5 z-50 select-none group"
    >
      <svg
        width="10"
        height="10"
        viewBox="0 0 10 10"
        className="text-[var(--text-muted)] opacity-40 group-hover:opacity-100 transition-opacity"
      >
        <line x1="2" y1="10" x2="10" y2="2" stroke="currentColor" strokeWidth="1.5" />
        <line x1="5" y1="10" x2="10" y2="5" stroke="currentColor" strokeWidth="1.5" />
        <line x1="8" y1="10" x2="10" y2="8" stroke="currentColor" strokeWidth="1.5" />
      </svg>
    </div>
  );
};
