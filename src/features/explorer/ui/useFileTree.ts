import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { explorerClient } from "../client";
import { useWorkspaceStore } from "../../../store";
import { selectActiveFilePath } from "../../../app/tabSelectors";
import { notify } from "../../notifications";
import { useConfirm } from "../../../lib/ui/useConfirm";
import { gitService } from "../../git/ui";
import { resolveRepositoryForPath } from "../../git";
import { explorerService, refreshTree } from "./explorerService";
import { readDraggedPaths } from "./FileTreeNode";
import { type FileTreeMenuAction } from "./FileTreeContextMenu";
import { canonicalizeFilePath } from "../../../app/tabs/identity";
import { createTargetFor, flattenVisible, indexByPath, movablePaths, rangeSelection, resolveTreeKey, toggleInSelection, type FileEntry } from "../model";

interface ContextMenuState {
  x: number;
  y: number;
  node: FileEntry;
}

/** Opens a file in a tab, or a saved `.rusty/canvas/*.json` as a canvas. */
async function openEntry(node: FileEntry): Promise<void> {
  if (node.path.includes("/.rusty/canvas/") && node.path.endsWith(".json")) {
    try {
      const { canvasFileService } = await import("../../canvas/ui");
      const data = await canvasFileService.loadCanvasFromFile(node.path);
      data.id ||= `canvas_${Date.now()}`;
      useWorkspaceStore.getState().loadCanvasTab(data);
    } catch (err: any) {
      notify("Canvas error", `Failed to load canvas: ${err.message || err}`, "error");
    }
    return;
  }
  useWorkspaceStore.getState().openTab({ type: "file", path: node.path, title: node.name });
}

/** The repository a path belongs to (a submodule's own, not the workspace root's). */
function repositoryRootFor(path: string): string | null {
  const state = useWorkspaceStore.getState();
  return resolveRepositoryForPath(path, state.repositories)?.worktreePath ?? state.rootPath ?? null;
}

/** Selection, focus, keyboard, drag-and-drop, dialogs and context menu for the file tree. */
export function useFileTree(entries: FileEntry[]) {
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [moveDialogNode, setMoveDialogNode] = useState<FileEntry | null>(null);
  const [renamingPath, setRenamingPath] = useState<string | null>(null);
  const [createDialog, setCreateDialog] = useState<{ type: "file" | "folder"; dir: string; name: string } | null>(null);
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(() => new Set());
  const [focusedPath, setFocusedPath] = useState<string | null>(null);
  const treeContainerRef = useRef<HTMLDivElement>(null);
  const { confirm, ConfirmModalComponent } = useConfirm();

  const revealPath = useWorkspaceStore((state) => state.revealPath);
  const clearRevealPath = useWorkspaceStore((state) => state.clearRevealPath);
  const fileTreeSelectionRequest = useWorkspaceStore((state) => state.fileTreeSelectionRequest);
  const clearFileTreeSelectionRequest = useWorkspaceStore((state) => state.clearFileTreeSelectionRequest);
  const activeFilePath = useWorkspaceStore(selectActiveFilePath);
  const revealFileInTree = useWorkspaceStore((state) => state.revealFileInTree);
  const expandedPaths = useWorkspaceStore((state) => state.expandedPaths);
  const setPathExpanded = useWorkspaceStore((state) => state.setPathExpanded);

  const visibleEntries = useMemo(() => flattenVisible(entries, expandedPaths), [entries, expandedPaths]);
  const entriesByPath = useMemo(() => indexByPath(entries), [entries]);

  // Drop selection/focus for paths that disappeared (deleted, moved, renamed).
  useEffect(() => {
    setSelectedPaths((current) => new Set([...current].filter((path) => entriesByPath.has(path))));
    setFocusedPath((current) => (current && entriesByPath.has(current) ? current : null));
  }, [entriesByPath]);

  useEffect(() => {
    if (!revealPath || !treeContainerRef.current) return;
    const timer = setTimeout(() => {
      treeContainerRef.current
        ?.querySelector(`[data-file-path="${CSS.escape(revealPath)}"]`)
        ?.scrollIntoView({ behavior: "smooth", block: "center" });
      clearRevealPath();
    }, 100);
    return () => clearTimeout(timer);
  }, [revealPath, clearRevealPath]);

  useEffect(() => {
    if (!fileTreeSelectionRequest || !treeContainerRef.current) return;
    const requestedPath = canonicalizeFilePath(fileTreeSelectionRequest.path);
    const entry = visibleEntries.find(
      (candidate) => !candidate.is_dir && canonicalizeFilePath(candidate.path) === requestedPath,
    );
    if (!entry) return;

    setSelectedPaths(new Set([entry.path]));
    setFocusedPath(entry.path);
    treeContainerRef.current.focus({ preventScroll: true });
    scrollIntoView(entry.path);
    clearFileTreeSelectionRequest(fileTreeSelectionRequest.requestId);
  }, [fileTreeSelectionRequest, visibleEntries, clearFileTreeSelectionRequest]);

  const activateEntry = (node: FileEntry) => {
    if (node.is_dir) setPathExpanded(node.path, !expandedPaths[node.path]);
    else void openEntry(node);
  };

  const scrollIntoView = (path: string) =>
    requestAnimationFrame(() =>
      treeContainerRef.current?.querySelector(`[data-file-path="${CSS.escape(path)}"]`)?.scrollIntoView?.({ block: "nearest" }),
    );

  const describePath = (path: string) => {
    const node = entriesByPath.get(path);
    return { path, name: node?.name ?? path.split("/").pop() ?? "", isDir: !!node?.is_dir };
  };

  /** Deletes the target (or the whole selection when the target is part of it) after confirmation. */
  const handleDelete = async (target?: FileEntry) => {
    let paths: string[] = [];
    if (target) paths = selectedPaths.has(target.path) && selectedPaths.size > 1 ? [...selectedPaths] : [target.path];
    else if (selectedPaths.size > 0) paths = [...selectedPaths];
    else if (focusedPath) paths = [focusedPath];
    if (paths.length === 0) return;
    try {
      const performed = await explorerService.deleteItems(paths.map(describePath), (opts) => confirm(opts));
      if (performed) setSelectedPaths(new Set());
    } catch (err) {
      console.error("Delete failed:", err);
    }
  };

  const movePaths = async (paths: string[], destinationDir: string) => {
    const movable = movablePaths(paths, destinationDir);
    if (movable.length === 0) return;
    try {
      for (const srcPath of movable) {
        const destPath = `${destinationDir}/${srcPath.split("/").pop() || ""}`;
        if (srcPath !== destPath) await explorerClient.move(srcPath, destPath);
      }
      await refreshTree();
      setPathExpanded(destinationDir, true);
      setSelectedPaths(new Set());
      notify("Items moved", `Moved ${movable.length} item${movable.length === 1 ? "" : "s"}.`, "success");
    } catch (err) {
      await refreshTree();
      notify("Move failed", `Some items could not be moved: ${err}`, "error");
    }
  };

  const handleEntryClick = (event: React.MouseEvent, node: FileEntry) => {
    treeContainerRef.current?.focus({ preventScroll: true });
    if (event.shiftKey && focusedPath) {
      const range = rangeSelection(visibleEntries, focusedPath, node.path);
      if (range) {
        setSelectedPaths(range);
        return;
      }
    }
    setFocusedPath(node.path);
    if (event.metaKey || event.ctrlKey) {
      setSelectedPaths((current) => toggleInSelection(current, node.path));
      return;
    }
    setSelectedPaths(new Set([node.path]));
    activateEntry(node);
  };

  const handleTreeKeyDown = (event: React.KeyboardEvent) => {
    if (renamingPath) return;
    const action = resolveTreeKey(event, { visible: visibleEntries, focusedPath, expanded: expandedPaths });
    if (!action) return;
    event.preventDefault();
    event.stopPropagation();
    switch (action.type) {
      case "focus":
        setFocusedPath(action.path);
        setSelectedPaths((current) => (action.extend ? new Set([...current, action.path]) : new Set([action.path])));
        scrollIntoView(action.path);
        break;
      case "expand":
        setPathExpanded(action.path, action.open);
        break;
      case "activate":
        activateEntry(action.entry);
        break;
      case "select":
        setSelectedPaths((current) => (action.toggle ? toggleInSelection(current, action.path) : new Set([action.path])));
        break;
      case "delete":
        void handleDelete();
        break;
    }
  };

  const handleContextMenu = (event: React.MouseEvent, node: FileEntry) => {
    event.preventDefault();
    event.stopPropagation();
    if (!selectedPaths.has(node.path)) {
      setSelectedPaths(new Set([node.path]));
      setFocusedPath(node.path);
    }
    setContextMenu({ x: event.clientX, y: event.clientY, node });
  };

  const handleMenuAction = async (action: FileTreeMenuAction, node: FileEntry) => {
    setContextMenu(null);
    try {
      switch (action) {
        case "newFile":
        case "newFolder":
          setCreateDialog({ type: action === "newFile" ? "file" : "folder", ...createTargetFor(node) });
          break;
        case "rename":
          setRenamingPath(node.path);
          break;
        case "move":
          setMoveDialogNode(node);
          break;
        case "delete":
          await handleDelete(node);
          break;
        case "finder":
          await explorerService.openInFinder(node.path);
          break;
        case "addToGit": {
          const repo = repositoryRootFor(node.path);
          if (repo) await gitService.stageFile(repo, node.path);
          break;
        }
        case "addToGitignore": {
          const repo = repositoryRootFor(node.path);
          if (repo) await gitService.addToGitignore(repo, node.path);
          break;
        }
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleDropOnRoot = async (event: React.DragEvent) => {
    event.preventDefault();
    event.stopPropagation();
    const rootPath = useWorkspaceStore.getState().rootPath;
    if (!rootPath) return;
    try {
      await movePaths(readDraggedPaths(event), rootPath);
    } catch (err) {
      console.error("Failed to move file to root:", err);
    }
  };

  const closeContextMenu = useCallback(() => setContextMenu(null), []);

  return {
    treeContainerRef,
    handleTreeKeyDown,
    handleDropOnRoot,
    activeFilePath,
    revealFileInTree,
    renamingPath,
    setRenamingPath,
    selectedPaths,
    setSelectedPaths,
    focusedPath,
    setFocusedPath,
    handleContextMenu,
    setCreateDialog,
    handleEntryClick,
    movePaths,
    contextMenu,
    handleMenuAction,
    closeContextMenu,
    moveDialogNode,
    setMoveDialogNode,
    createDialog,
    ConfirmModalComponent,
  };
}
