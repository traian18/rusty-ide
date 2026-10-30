import React, { useState, useEffect, useCallback } from "react";
import { useWorkspaceStore } from "../../../../../store";
import { open as openDialog } from "../../../../../lib/platform/dialog";
import { parseDragData, getDefaultContextName } from "../../../nodes/contextNode/helpers";
import { useDebouncedSearch, useContextNodeDrag } from "./hooks";
import { searchService } from "../../../../explorer";
import type { ContextNodeData } from "../../../nodes/contextNode/types";

/** State, handlers and store wiring for one ContextNode. */
export function useContextNode(id: string, data: ContextNodeData) {
  /* ---- Store Selectors ---- */
  const updateNode = useWorkspaceStore((state) => state.updateTaskNode);
  const openTab = useWorkspaceStore((state) => state.openTab);
  const deleteNode = useWorkspaceStore((state) => state.deleteNode);
  const rootPath = useWorkspaceStore((state) => state.rootPath);

  /* ---- Local State ---- */
  const [isEditing, setIsEditing] = useState(false);
  const [tempName, setTempName] = useState(data.name || "");
  const [showSearch, setShowSearch] = useState(false);

  /* ---- Derived Values ---- */
  const isMinimized = !!data.isMinimized;
  const hasFilePath = !!data.path;

  /* ---- Sync temp name when data.name changes externally ---- */
  useEffect(() => {
    setTempName(data.name || "");
  }, [data.name]);

  /* ---- Search Overlay State ---- */
  const {
    query: searchQuery,
    setQuery: setSearchQuery,
    results: searchResults,
    isSearching,
    selectedIndex,
    setSelectedIndex,
    searchInputRef,
  } = useDebouncedSearch({
    rootPath,
    enabled: showSearch,
  });

  /* ---- Drag & Drop ---- */
  const handleDropData = useCallback(
    (e: React.DragEvent): void => {
      // 1. Try parsing internal drag payload from Rusty file tree
      const rawData = e.dataTransfer.getData("text/plain");
      if (rawData) {
        const dragData = parseDragData(rawData);
        if (dragData) {
          updateNode(id, {
            path: dragData.path,
            fileName: dragData.name,
            isDir: dragData.isDir,
            name: !data.name ? getDefaultContextName(dragData.name) : data.name,
          });
          return;
        }
      }

      // 2. Try native drag-and-drop file payload (e.g. from desktop or Finder)
      if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        const file = e.dataTransfer.files[0];
        const filePath = (file as any).path || file.name;
        const fileName = file.name || filePath.split("/").pop() || filePath;
        if (filePath) {
          updateNode(id, {
            path: filePath,
            fileName,
            isDir: false,
            name: !data.name ? getDefaultContextName(fileName) : data.name,
          });
        }
      }
    },
    [id, data.name, updateNode],
  );

  const { dragOver, handleDragOver, handleDragLeave, handleDrop } =
    useContextNodeDrag(handleDropData);

  /* ---- Handlers: Name Editing ---- */

  /** Persist the edited name and exit edit mode. */
  const handleNameSave = useCallback((): void => {
    updateNode(id, { name: tempName });
    setIsEditing(false);
  }, [id, tempName, updateNode]);

  /** Discard the edit and revert to the stored name. */
  const handleCancelEdit = useCallback((): void => {
    setTempName(data.name || "");
    setIsEditing(false);
  }, [data.name]);

  /** Enter name-edit mode. */
  const handleStartEdit = useCallback((): void => {
    setIsEditing(true);
  }, []);

  /** Delete this node from the canvas. */
  const handleDelete = useCallback((): void => {
    deleteNode(id);
  }, [id, deleteNode]);

  /* ---- Handlers: File Action ---- */

  /** Opens the attached file in a new editor tab. */
  const handleFileClick = useCallback(
    (e: React.MouseEvent): void => {
      e.stopPropagation();
      if (data.path && !data.isDir) {
        openTab({
          type: "file",
          path: data.path,
          title: data.fileName || "File",
        });
      }
    },
    [data.path, data.isDir, data.fileName, openTab],
  );

  /** Clears the attached context file from the node. */
  const handleClearContext = useCallback(
    (e: React.MouseEvent): void => {
      e.stopPropagation();
      const shouldResetName =
        typeof data.name === "string" && data.name.startsWith("Context: ");
      updateNode(id, {
        path: "",
        fileName: "",
        isDir: false,
        name: shouldResetName ? "" : data.name,
      });
    },
    [id, data.name, updateNode],
  );

  /** Updates the description text on every keystroke. */
  const handleDescriptionChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>): void => {
      updateNode(id, { description: e.target.value });
    },
    [id, updateNode],
  );

  /** Toggles the description textarea between minimized and expanded. */
  const handleToggleMinimize = useCallback((): void => {
    updateNode(id, { isMinimized: !isMinimized });
  }, [id, isMinimized, updateNode]);

  /* ---- Handlers: Search Overlay ---- */

  /** Opens the file-search overlay. */
  const handleOpenSearch = useCallback((): void => {
    setShowSearch(true);
  }, []);

  /** Closes the search overlay and resets search state. */
  const handleSearchClose = useCallback((): void => {
    setShowSearch(false);
    setSearchQuery("");
    setSelectedIndex(0);
  }, [setSearchQuery, setSelectedIndex]);

  /** Attaches a selected search result to the node. */
  const handleSearchSelect = useCallback(
    async (match: { path: string; name: string; isDir?: boolean }): Promise<void> => {
      let resolvedPath = match.path;
      let resolvedName = match.name;
      let isDir = !!match.isDir;

      try {
        const info = await searchService.checkExternalPath(match.path);
        if (info && info.exists) {
          resolvedPath = info.path;
          resolvedName = info.name;
          isDir = info.is_dir;
        }
      } catch {
        // Fall back to match values
      }

      updateNode(id, {
        path: resolvedPath,
        fileName: resolvedName,
        isDir,
        name: !data.name ? getDefaultContextName(resolvedName) : data.name,
      });
      handleSearchClose();
    },
    [id, data.name, updateNode, handleSearchClose],
  );

  /** Handles keyboard events inside the search input. */
  const handleSearchKeyDown = useCallback(
    (e: React.KeyboardEvent): void => {
      if (e.key === "Escape") {
        handleSearchClose();
        return;
      }

      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((prev) => Math.min(prev + 1, searchResults.length - 1));
        return;
      }

      if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex((prev) => Math.max(prev - 1, 0));
        return;
      }

      if (e.key === "Enter") {
        e.preventDefault();
        if (searchResults.length > 0) {
          void handleSearchSelect(searchResults[selectedIndex] || searchResults[0]);
          return;
        }

        const trimmed = searchQuery.trim();
        if (trimmed) {
          const name = trimmed.split(/[\\/]/).pop() || trimmed;
          void handleSearchSelect({ path: trimmed, name });
        }
      }
    },
    [searchResults, selectedIndex, searchQuery, handleSearchClose, handleSearchSelect, setSelectedIndex],
  );

  /* ---- Handlers: Browse External Files / Folders ---- */

  /** Opens the native OS file picker to select any file on the system. */
  const handleBrowseFile = useCallback(async (): Promise<void> => {
    try {
      const selected = await openDialog({
        multiple: false,
        directory: false,
        title: "Select Context File",
      });
      if (selected && typeof selected === "string") {
        const name = selected.split("/").pop() || selected;
        updateNode(id, {
          path: selected,
          fileName: name,
          isDir: false,
          name: !data.name ? getDefaultContextName(name) : data.name,
        });
        if (showSearch) {
          handleSearchClose();
        }
      }
    } catch (err) {
      console.error("[ContextNode] Failed to browse context file:", err);
    }
  }, [id, data.name, showSearch, updateNode, handleSearchClose]);

  /** Opens the native OS file picker to select any folder on the system. */
  const handleBrowseFolder = useCallback(async (): Promise<void> => {
    try {
      const selected = await openDialog({
        multiple: false,
        directory: true,
        title: "Select Context Folder",
      });
      if (selected && typeof selected === "string") {
        const name = selected.split("/").pop() || selected;
        updateNode(id, {
          path: selected,
          fileName: name,
          isDir: true,
          name: !data.name ? getDefaultContextName(name) : data.name,
        });
        if (showSearch) {
          handleSearchClose();
        }
      }
    } catch (err) {
      console.error("[ContextNode] Failed to browse context folder:", err);
    }
  }, [id, data.name, showSearch, updateNode, handleSearchClose]);

  return {
    dragOver,
    handleDragOver,
    handleDragLeave,
    handleDrop,
    isEditing,
    tempName,
    hasFilePath,
    setTempName,
    handleNameSave,
    handleCancelEdit,
    handleStartEdit,
    handleOpenSearch,
    handleBrowseFile,
    handleDelete,
    isMinimized,
    handleFileClick,
    handleClearContext,
    handleBrowseFolder,
    handleDescriptionChange,
    handleToggleMinimize,
    showSearch,
    searchQuery,
    searchResults,
    isSearching,
    selectedIndex,
    rootPath,
    searchInputRef,
    setSearchQuery,
    handleSearchSelect,
    handleSearchKeyDown,
    handleSearchClose,
  };
}
