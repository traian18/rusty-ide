import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ExternalLink, EyeOff, FilePlus, FolderInput, FolderPlus, Pencil, Plus, Trash2, type LucideIcon } from "lucide-react";

export type FileTreeMenuAction = "newFile" | "newFolder" | "rename" | "move" | "addToGit" | "addToGitignore" | "finder" | "delete";

interface MenuItem {
  icon: LucideIcon;
  label: string;
  action: FileTreeMenuAction;
  danger?: boolean;
}

/** Groups are separated by dividers. */
function menuGroups(selectedCount: number): MenuItem[][] {
  return [
    [
      { icon: FilePlus, label: "New File", action: "newFile" },
      { icon: FolderPlus, label: "New Folder", action: "newFolder" },
    ],
    [
      { icon: Pencil, label: "Rename", action: "rename" },
      { icon: FolderInput, label: "Move...", action: "move" },
    ],
    [
      { icon: Plus, label: "Add to Git", action: "addToGit" },
      { icon: EyeOff, label: "Add to .gitignore", action: "addToGitignore" },
    ],
    [{ icon: ExternalLink, label: "Reveal in Finder", action: "finder" }],
    [{ icon: Trash2, label: selectedCount > 1 ? `Delete (${selectedCount} items)` : "Delete", action: "delete", danger: true }],
  ];
}

export const FileTreeContextMenu: React.FC<{
  x: number;
  y: number;
  selectedCount: number;
  onAction: (action: FileTreeMenuAction) => void;
  onClose: () => void;
}> = ({ x, y, selectedCount, onAction, onClose }) => {
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x, y });

  // Keep the menu inside the window when opened near the right/bottom edge.
  useLayoutEffect(() => {
    const rect = menuRef.current?.getBoundingClientRect();
    if (!rect) return;
    setPos({
      x: x + rect.width > window.innerWidth ? window.innerWidth - rect.width - 8 : x,
      y: y + rect.height > window.innerHeight ? window.innerHeight - rect.height - 8 : y,
    });
  }, [x, y]);

  useEffect(() => {
    const handleOutsideClick = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) onClose();
    };
    const handleEscape = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    document.addEventListener("mousedown", handleOutsideClick);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handleOutsideClick);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [onClose]);

  return createPortal(
    <div
      ref={menuRef}
      role="menu"
      data-context-menu="true"
      style={{ left: pos.x, top: pos.y }}
      className="fixed z-[9999] bg-[var(--bg-sidebar)] border border-[var(--border-color)] rounded-lg shadow-2xl py-1 min-w-[180px] font-sans text-xs"
      onClick={(event) => event.stopPropagation()}
    >
      {menuGroups(selectedCount).map((group, groupIdx) => (
        <React.Fragment key={groupIdx}>
          {groupIdx > 0 && <div className="h-px bg-[var(--border-color)]/50 my-1" />}
          {group.map(({ icon: Icon, label, action, danger }) => (
            <button
              key={action}
              type="button"
              role="menuitem"
              onClick={() => onAction(action)}
              className={`w-full flex items-center space-x-2.5 px-3 py-1.5 text-left hover:bg-[var(--accent-bg)] transition-colors ${
                danger ? "text-[var(--color-status-danger)] hover:bg-[var(--color-status-danger-bg)]" : "text-[var(--text-normal)] hover:text-[var(--text-light)]"
              }`}
            >
              <Icon size={13} className="flex-shrink-0" />
              <span>{label}</span>
            </button>
          ))}
        </React.Fragment>
      ))}
    </div>,
    document.body,
  );
};
