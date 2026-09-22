/**
 * Footer section of the GlobalChatNode.
 *
 * Provides an "Open Pane" button that selects the node and opens the
 * workspace explorer side pane, along with a static info label.
 */

import React from "react";
import { Settings } from "lucide-react";
import { stopNodePropagation } from "./stopPropagation";

interface GlobalChatNodeFooterProps {
  /** Fired when the "Open Pane" button is clicked. */
  onOpenPane: () => void;
}

export const GlobalChatNodeFooter: React.FC<GlobalChatNodeFooterProps> = ({
  onOpenPane,
}) => {
  return (
    <div className="bg-[var(--color-surface-sunken)] px-3 py-1.5 border-t border-[var(--border-color)] flex items-center justify-between text-[10px] select-none flex-shrink-0">
      <button
        onClick={(e) => {
          e.stopPropagation();
          onOpenPane();
        }}
        onPointerDown={stopNodePropagation}
        onMouseDown={stopNodePropagation}
        className="nodrag text-[var(--text-muted)] hover:text-[var(--color-status-warning)] hover:scale-110 active:scale-95 transition-all p-0.5 rounded cursor-pointer flex items-center space-x-1 group"
        title="Open Explorer Pane"
      >
        <Settings
          size={13}
          className="group-hover:rotate-45 transition-transform duration-300 pointer-events-none"
        />
        <span className="font-sans text-[9px] font-semibold pointer-events-none">
          Open Pane
        </span>
      </button>

      <span className="text-[9px] font-sans text-[var(--text-muted)] pr-2">
        Planning only · plans/
      </span>
    </div>
  );
};
