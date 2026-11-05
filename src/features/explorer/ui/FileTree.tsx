import React from "react";
import { TreePine } from "lucide-react";
import { MoveDialog } from "./MoveDialog";
import { CreateDialog } from "./CreateDialog";
import { explorerService } from "./explorerService";
import { FileTreeNode } from "./FileTreeNode";
import { FileTreeContextMenu } from "./FileTreeContextMenu";
import { useFileTree } from "./useFileTree";
import type { FileEntry } from "../model";

export type { FileEntry } from "../model";

interface FileTreeProps {
  entries: FileEntry[];
}

export const FileTree: React.FC<FileTreeProps> = ({ entries }) => {
  const {
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
  } = useFileTree(entries);

  return (
    <div
      ref={treeContainerRef}
      role="tree"
      aria-label="Project files"
      aria-multiselectable
      tabIndex={0}
      onKeyDown={handleTreeKeyDown}
      onDragOver={(event) => event.preventDefault()}
      onDrop={handleDropOnRoot}
      className="space-y-[1px] select-none font-sans text-xs text-[var(--text-normal)] w-max min-w-full min-h-[300px] focus:outline-none"
    >
      <div className="flex items-center justify-between px-2 py-1.5 border-b border-[var(--border-color)] bg-[var(--bg-sidebar)]/50 sticky top-0 z-10">
        <span className="text-[10px] font-mono text-[var(--text-muted)] uppercase tracking-wide">Files</span>
        <button
          type="button"
          id="reveal-active-file-btn"
          onClick={() => activeFilePath && revealFileInTree(activeFilePath)}
          className="text-[9px] font-mono text-[var(--text-muted)] hover:text-[var(--text-light)] hover:bg-[var(--accent-bg)] px-1.5 py-0.5 rounded transition-colors cursor-pointer flex items-center space-x-1"
          title="Reveal active file in tree"
        >
          <TreePine size={10} />
          <span>Reveal</span>
        </button>
      </div>

      {entries.map((entry) => (
        <FileTreeNode
          key={entry.path}
          node={entry}
          renamingPath={renamingPath}
          selectedPaths={selectedPaths}
          focusedPath={focusedPath}
          onContextMenu={handleContextMenu}
          onRenameComplete={() => setRenamingPath(null)}
          onCreateRequest={(type, dir, name) => setCreateDialog({ type, dir, name })}
          onEntryClick={handleEntryClick}
          onDragSelection={(node) => {
            setFocusedPath(node.path);
            setSelectedPaths(new Set([node.path]));
          }}
          onMovePaths={movePaths}
        />
      ))}

      {contextMenu && (
        <FileTreeContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          selectedCount={selectedPaths.has(contextMenu.node.path) && selectedPaths.size > 1 ? selectedPaths.size : 1}
          onAction={(action) => void handleMenuAction(action, contextMenu.node)}
          onClose={closeContextMenu}
        />
      )}

      {moveDialogNode && (
        <MoveDialog
          node={moveDialogNode}
          fileTree={entries}
          onMove={async (destination) => {
            try {
              await explorerService.moveItem(moveDialogNode.path, destination);
            } catch (err) {
              console.error(err);
            }
            setMoveDialogNode(null);
          }}
          onCancel={() => setMoveDialogNode(null)}
        />
      )}

      {createDialog && (
        <CreateDialog
          type={createDialog.type}
          parentDir={createDialog.dir}
          onCreate={async (name) => {
            try {
              await (createDialog.type === "file"
                ? explorerService.createFile(createDialog.dir, name)
                : explorerService.createFolder(createDialog.dir, name));
            } catch (err) {
              console.error(err);
            }
            setCreateDialog(null);
          }}
          onCancel={() => setCreateDialog(null)}
        />
      )}

      {ConfirmModalComponent}
    </div>
  );
};
