import React, { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { Plus, EyeOff } from "lucide-react";
import type { GitFileStatus } from "../git/GitActions";

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────

interface GitFileContextMenuProps {
  /** Absolute X coordinate of the context menu. */
  x: number;
  /** Absolute Y coordinate of the context menu. */
  y: number;
  /** The file that was right-clicked. */
  file: GitFileStatus;
  /** Called when the user selects "Add to Git". */
  onAddToGit: () => Promise<void>;
  /** Called when the user selects "Add to .gitignore". */
  onAddToGitignore: () => void;
}

// ─────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────

/**
 * Right-click context menu for a file in the Source Control
 * change list.
 *
 * Rendered as a portal into `document.body` so it overlays
 * correctly regardless of scroll containers.
 */
export const GitFileContextMenu: React.FC<GitFileContextMenuProps> = ({
  x,
  y,
  onAddToGit,
  onAddToGitignore,
}) => {
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x, y });

  /** Adjust position so the menu stays inside the viewport. */
  useEffect(() => {
    if (menuRef.current) {
      const rect = menuRef.current.getBoundingClientRect();
      let adjX = x;
      let adjY = y;
      if (x + rect.width > window.innerWidth) {
        adjX = window.innerWidth - rect.width - 8;
      }
      if (y + rect.height > window.innerHeight) {
        adjY = window.innerHeight - rect.height - 8;
      }
      setPos({ x: adjX, y: adjY });
    }
  }, [x, y]);

  const items = [
    {
      icon: Plus,
      label: "Add to Git",
      action: onAddToGit,
    },
    {
      icon: EyeOff,
      label: "Add to .gitignore",
      action: onAddToGitignore,
    },
  ];

  return createPortal(
    <div
      ref={menuRef}
      data-context-menu="true"
      style={{ left: pos.x, top: pos.y }}
      className="fixed z-[9999] bg-[var(--bg-sidebar)] border border-[var(--border-color)] rounded-lg shadow-2xl py-1 min-w-[180px] font-sans text-xs"
      onClick={(e) => e.stopPropagation()}
    >
      {items.map((item, idx) => (
        <button
          key={idx}
          onClick={item.action}
          className="w-full flex items-center space-x-2.5 px-3 py-1.5 text-left text-[var(--text-normal)] hover:text-[var(--text-light)] hover:bg-[var(--accent-bg)] transition-colors"
        >
          <item.icon size={13} className="flex-shrink-0" />
          <span>{item.label}</span>
        </button>
      ))}
    </div>,
    document.body,
  );
};
