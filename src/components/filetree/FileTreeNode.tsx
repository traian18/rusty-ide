import React, { useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronRight, Folder, FolderOpen, FolderPlus, Plus } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { useWorkspaceStore } from "../../store";
import { selectActiveTabId } from "../../store/tabSelectors";
import { fileTabIdentity } from "../../tabs/identity";
import { FileIcon } from "../../services/fileTypeService";
import { notify } from "../../notificationStore";
import { resolveRepositoryForPath } from "../git/resolveRepositoryForPath";
import { refreshTree } from "./FileTreePresenter";
import { getGitState } from "./fileTreeGitState";
import { parentDirOf, type FileEntry } from "./fileTreeModel";

/** Folder icons use the accent (orange) unless a git marker recolors them. */
const FOLDER_ICON_CLASS = "mr-1 text-[var(--accent-color)] flex-shrink-0";
const FOCUS_RING_CLASS = "ring-1 ring-inset ring-[var(--accent-color)]/60";

export interface FileTreeNodeProps {
  node: FileEntry;
  renamingPath: string | null;
  selectedPaths: Set<string>;
  focusedPath: string | null;
  onContextMenu: (event: React.MouseEvent, node: FileEntry) => void;
  onRenameComplete: () => void;
  onCreateRequest: (type: "file" | "folder", dir: string, name: string) => void;
  onEntryClick: (event: React.MouseEvent, node: FileEntry) => void;
  onDragSelection: (node: FileEntry) => void;
  onMovePaths: (paths: string[], destinationDir: string) => Promise<void>;
}

/** Reads the dragged paths written by `handleDragStart`. */
export function readDraggedPaths(event: React.DragEvent): string[] {
  const raw = event.dataTransfer.getData("text/plain");
  if (!raw) return [];
  const data = JSON.parse(raw);
  return Array.isArray(data.paths) ? data.paths : data.path ? [data.path] : [];
}

export const FileTreeNode: React.FC<FileTreeNodeProps> = (props) => {
  const { node, renamingPath, selectedPaths, focusedPath, onContextMenu, onRenameComplete, onCreateRequest, onEntryClick, onDragSelection, onMovePaths } = props;
  const expandedPaths = useWorkspaceStore((state) => state.expandedPaths);
  const gitStatus = useWorkspaceStore((state) => state.gitStatus);
  const repositories = useWorkspaceStore((state) => state.repositories);
  const statusByRepositoryId = useWorkspaceStore((state) => state.statusByRepositoryId);
  const activeTabId = useWorkspaceStore(selectActiveTabId);

  const [tempName, setTempName] = useState(node.name);
  const renameInputRef = useRef<HTMLInputElement>(null);

  const isRenaming = renamingPath === node.path;
  const isOpen = !!expandedPaths[node.path];
  const isSelected = selectedPaths.has(node.path);
  const isFocused = focusedPath === node.path;
  // A path inside a submodule or linked worktree gets that repository's
  // status rather than the workspace root's.
  const resolvedRepo = resolveRepositoryForPath(node.path, repositories);
  const nodeGitStatus = resolvedRepo && resolvedRepo.kind !== "workspace" ? statusByRepositoryId[resolvedRepo.id] ?? null : gitStatus;
  const gitState = getGitState(node, nodeGitStatus);
  const isActiveFile = activeTabId === fileTabIdentity(node.path);

  useEffect(() => {
    if (!isRenaming) return;
    setTempName(node.name);
    const input = renameInputRef.current;
    if (!input) return;
    input.focus();
    const dotIdx = node.name.lastIndexOf(".");
    if (dotIdx > 0 && !node.is_dir) input.setSelectionRange(0, dotIdx);
    else input.select();
  }, [isRenaming, node.name, node.is_dir]);

  const handleDragStart = (event: React.DragEvent) => {
    const paths = isSelected ? [...selectedPaths] : [node.path];
    if (!isSelected) onDragSelection(node);
    const payload = JSON.stringify({ path: node.path, paths, name: node.name, isDir: !!node.is_dir });
    event.dataTransfer.setData("text/plain", payload);
    event.dataTransfer.setData("application/x-rusty-files", payload);
    event.dataTransfer.effectAllowed = "move";
  };

  const handleRename = async () => {
    const newName = tempName.trim();
    if (!newName || newName === node.name) {
      onRenameComplete();
      return;
    }
    const newPath = `${parentDirOf(node.path)}/${newName}`;
    try {
      await invoke("move_file_or_dir", { src: node.path, dest: newPath });
      await refreshTree();
      const state = useWorkspaceStore.getState();
      state.closeTab(fileTabIdentity(node.path));
      state.setLastRename({ originalPath: node.path, newPath });
      void state.loadGitStatus();
    } catch (err) {
      notify("Rename failed", `Rename failed: ${err}`, "error");
    }
    onRenameComplete();
  };

  const handleDropOnNode = async (event: React.DragEvent) => {
    event.preventDefault();
    event.stopPropagation();
    if (!node.is_dir) return;
    try {
      await onMovePaths(readDraggedPaths(event), node.path);
    } catch (err) {
      notify("Move failed", `Move failed: ${err}`, "error");
    }
  };

  const renameInput = (
    <input
      ref={renameInputRef}
      type="text"
      value={tempName}
      onChange={(event) => setTempName(event.target.value)}
      onPointerDown={(event) => event.stopPropagation()}
      onMouseDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === "Enter") void handleRename();
        if (event.key === "Escape") onRenameComplete();
      }}
      onBlur={() => void handleRename()}
      className="nodrag bg-[var(--bg-app)] border border-[var(--accent-color)] rounded px-1 py-0 text-xs text-[var(--text-light)] focus:outline-none w-full"
    />
  );

  const gitMarker = (className: string) =>
    gitState && (
      <span className={className} title={gitState.label}>
        {gitState.char}
      </span>
    );

  const rowProps = {
    role: "treeitem",
    "aria-selected": isSelected,
    "data-file-path": node.path,
    draggable: true,
    onDragStart: handleDragStart,
    onClick: (event: React.MouseEvent) => !isRenaming && onEntryClick(event, node),
    onContextMenu: (event: React.MouseEvent) => onContextMenu(event, node),
    style: { WebkitUserDrag: "element" } as React.CSSProperties,
  };

  if (!node.is_dir) {
    const stateClass = isSelected
      ? "bg-[var(--accent-bg)] border-[var(--border-active)] text-[var(--text-light)] font-medium shadow-sm"
      : isActiveFile
        ? "bg-[var(--color-surface-sunken)] border-[var(--color-border-subtle)] text-[var(--text-light)] font-medium shadow-sm"
        : `hover:bg-[var(--accent-bg)] hover:text-[var(--text-light)] border-transparent hover:border-[var(--border-color)]/20 ${gitState ? gitState.colorClass : "text-[var(--text-normal)]"}`;
    return (
      <div
        {...rowProps}
        className={`group relative flex items-center justify-between py-1 px-1.5 pl-[18px] transition-all cursor-grab active:cursor-grabbing font-sans text-xs w-full border rounded-md ${stateClass} ${isFocused ? FOCUS_RING_CLASS : ""}`}
      >
        <div className="flex items-center min-w-0 flex-1 mr-6">
          <FileIcon fileName={node.name} size={13} className="mr-1.5 flex-shrink-0" />
          {isRenaming ? renameInput : <span className="truncate pr-2">{node.name}</span>}
        </div>
        <div className="flex items-center space-x-1 mr-1">{gitMarker("text-[10px] font-mono font-bold opacity-90 select-none")}</div>
      </div>
    );
  }

  const selectionClass = isSelected
    ? "bg-[var(--accent-bg)] border-[var(--border-active)]"
    : "hover:bg-[var(--accent-bg)] border-transparent hover:border-[var(--border-color)]/20";
  const iconClass = gitState ? gitState.colorClass : "";
  return (
    <div className="w-full">
      <div
        {...rowProps}
        aria-expanded={isOpen}
        onDragOver={(event) => event.preventDefault()}
        onDrop={handleDropOnNode}
        className={`group relative flex items-center justify-between py-0.5 px-1 active:bg-[var(--border-color)]/60 cursor-grab active:cursor-grabbing hover:text-[var(--text-light)] transition-colors font-sans text-xs w-full border ${selectionClass} ${isFocused ? FOCUS_RING_CLASS : ""} ${gitState ? gitState.colorClass : "text-[var(--text-normal)]"}`}
      >
        <div className="flex items-center min-w-0 flex-1 mr-14">
          <span className="mr-0.5 text-[var(--text-muted)] flex-shrink-0">{isOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}</span>
          <span className={FOLDER_ICON_CLASS} data-folder-icon>
            {isOpen ? <FolderOpen size={13} className={iconClass} /> : <Folder size={13} className={iconClass} />}
          </span>
          {isRenaming ? renameInput : <span className="truncate pr-2">{node.name}</span>}
        </div>

        <div className="flex items-center space-x-1 mr-1">{gitMarker("text-[12px] font-mono font-bold opacity-85 select-none")}</div>

        {!isRenaming && (
          <div className="absolute right-1 top-0 bottom-0 opacity-0 group-hover:opacity-100 flex items-center space-x-1.5 bg-[var(--accent-bg)] pl-2 transition-opacity">
            <button
              type="button"
              onClick={(event) => { event.stopPropagation(); onCreateRequest("file", node.path, node.name); }}
              className="p-0.5 rounded hover:bg-[var(--accent-color)]/20 text-[var(--text-muted)] hover:text-[var(--text-light)] transition-colors cursor-pointer"
              title="New File"
            >
              <Plus size={11} />
            </button>
            <button
              type="button"
              onClick={(event) => { event.stopPropagation(); onCreateRequest("folder", node.path, node.name); }}
              className="p-0.5 rounded hover:bg-[var(--accent-color)]/20 text-[var(--text-muted)] hover:text-[var(--text-light)] transition-colors cursor-pointer"
              title="New Folder"
            >
              <FolderPlus size={11} />
            </button>
          </div>
        )}
      </div>
      {isOpen && node.children && (
        <div role="group" className="pl-2 border-l border-[var(--border-color)]/60 ml-1.5 mt-[1px] space-y-[1px]">
          {node.children.map((child) => (
            <FileTreeNode key={child.path} {...props} node={child} />
          ))}
        </div>
      )}
    </div>
  );
};
