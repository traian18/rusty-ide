/**
 * ContextNode — a React Flow node that attaches file/folder context and
 * free-form description notes to a Rusty pipeline.
 *
 * Responsibilities:
 * - Display an attached file/folder (from sidebar drag-drop or search).
 * - Provide a file-search overlay for browsing the workspace.
 * - Accept free-form description text with an expand/minimize toggle.
 * - Allow inline renaming and deletion.
 *
 * Architecture:
 * - **Orchestrator pattern.** This component wires store actions, local
 *   state, custom hooks, and pure helpers together, then delegates
 *   rendering to focused sub-components (Header, Content, SearchOverlay).
 * - **No nested functions.** Every callback is defined at the component
 *   body level and passed down as a prop.
 * - **Custom hooks** encapsulate debounced search (`useDebouncedSearch`)
 *   and drag-over visual feedback (`useContextNodeDrag`).
 * - **Helper module** (`helpers.ts`) provides pure utility functions
 *   for path formatting and drag-data parsing.
 */

import React, { memo } from "react";
import { Handle, Position } from "@xyflow/react";
import { ContextNodeHeader } from "./ContextNodeHeader";
import { ContextNodeContent } from "./ContextNodeContent";
import { ContextNodeSearchOverlay } from "./ContextNodeSearchOverlay";
import { useContextNode } from "./useContextNode";
import type { ContextNodeData } from "../../../nodes/contextNode/types";

/* ------------------------------------------------------------------ */
/*  HANDLE_STYLE                                                       */
/* ------------------------------------------------------------------ */

/** Shared style for the source handles. */
const HANDLE_STYLE: React.CSSProperties = {
  background: "var(--color-status-success-solid)",
  width: 14,
  height: 14,
  border: "2.5px solid var(--color-surface-sidebar)",
};

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export const ContextNode: React.FC<{
  id: string;
  data: ContextNodeData;
}> = memo(({ id, data }) => {
  const {
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
  } = useContextNode(id, data);

  /* ---- Render ---- */
  return (
    <div
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className={`w-72 rounded-xl border text-[var(--text-normal)] overflow-hidden transition-all duration-300 ${
        dragOver
          ? "border-[var(--color-status-success-border)] bg-[var(--bg-sidebar)] shadow-[0_0_15px_var(--color-status-success-bg)]"
          : "border-[var(--border-color)] bg-[var(--bg-sidebar)] hover:border-[var(--border-active)] shadow-lg"
      }`}
    >
      {/* ---- Header ---- */}
      <ContextNodeHeader
        name={data.name}
        isEditing={isEditing}
        tempName={tempName}
        hasFilePath={hasFilePath}
        onTempNameChange={setTempName}
        onNameSave={handleNameSave}
        onCancelEdit={handleCancelEdit}
        onStartEdit={handleStartEdit}
        onOpenSearch={handleOpenSearch}
        onBrowseFile={handleBrowseFile}
        onDelete={handleDelete}
      />

      {/* ---- Content ---- */}
      <ContextNodeContent
        path={data.path}
        fileName={data.fileName}
        isDir={data.isDir}
        description={data.description}
        isMinimized={isMinimized}
        onFileClick={handleFileClick}
        onClearContext={handleClearContext}
        onBrowseFile={handleBrowseFile}
        onBrowseFolder={handleBrowseFolder}
        onDescriptionChange={handleDescriptionChange}
        onToggleMinimize={handleToggleMinimize}
      />

      {/* ---- Search Overlay ---- */}
      {showSearch && (
        <ContextNodeSearchOverlay
          query={searchQuery}
          results={searchResults}
          isSearching={isSearching}
          selectedIndex={selectedIndex}
          rootPath={rootPath}
          inputRef={searchInputRef}
          onQueryChange={setSearchQuery}
          onResultSelect={handleSearchSelect}
          onKeyDown={handleSearchKeyDown}
          onBrowseFile={handleBrowseFile}
          onClose={handleSearchClose}
        />
      )}

      {/* ---- React Flow Handles ---- */}
      <Handle
        type="source"
        position={Position.Top}
        id="context-out-top"
        style={HANDLE_STYLE}
      />
      <Handle
        type="source"
        position={Position.Bottom}
        id="context-out-bottom"
        style={HANDLE_STYLE}
      />
    </div>
  );
});
