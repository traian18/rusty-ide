/**
 * GlobalChatNode — a planning and analysis node for the Rusty canvas.
 *
 * This node serves as a conversational entry point where users discuss tasks,
 * set context, and build plans for downstream TaskNodes. It includes:
 *
 * - An editable header with rename/delete actions and a status indicator.
 * - A skill selector that controls the system prompt, tools, and MCP bindings.
 * - An MCP server override for routing requests through a specific server.
 * - A scrollable summary / "Background Context" block.
 * - A resize handle for adjusting node dimensions.
 * - A footer with an "Open Pane" button.
 *
 * Architecture notes
 * -------------------
 * - **No nested functions.** All callbacks are defined at the hook or module level.
 * - **Single-responsibility.** Each sub-component (Header, Content, Footer, ResizeHandle)
 *   is extracted into its own file with a focused, documented interface.
 * - **Custom hooks** encapsulate resize geometry and scroll-wheel prevention.
 * - **Idiomatic & boring.** Follows established patterns from other Rusty node components.
 */

import React, { useState, memo, useContext, useRef } from "react";
import { useWorkspaceStore } from "../../../store";
import { CanvasTabContext } from "../../tabs/canvas/CanvasTabContext";
import { STATUS_BORDER_CLASSES } from "./statusBorderConfig";
import { useGlobalChatNodeResize } from "./useGlobalChatNodeResize";
import { useGlobalChatNodeScroll } from "./useGlobalChatNodeScroll";
import { GlobalChatNodeHeader } from "./GlobalChatNodeHeader";
import { GlobalChatNodeContent } from "./GlobalChatNodeContent";
import { GlobalChatNodeFooter } from "./GlobalChatNodeFooter";
import { GlobalChatNodeResizeHandle } from "./GlobalChatNodeResizeHandle";

export const GlobalChatNode: React.FC<{
  id: string;
  data: any;
}> = memo(({ id, data }) => {
  /* ── Context & Store ────────────────────────────────────────── */
  const { tabId } = useContext(CanvasTabContext);

  const updateNode = useWorkspaceStore((state) => state.updateTaskNode);
  const deleteNode = useWorkspaceStore((state) => state.deleteNode);
  const mcpServers = useWorkspaceStore((state) => state.mcpServers);
  const skills = useWorkspaceStore((state) => state.skills);
  const setSelectedNodeId = useWorkspaceStore(
    (state) => state.setSelectedNodeId,
  );

  const nodeStatus =
    (useWorkspaceStore(
      (state) =>
        (state.canvasContexts[tabId] || { nodeStatus: {} }).nodeStatus[id],
    ) || "idle") as keyof typeof STATUS_BORDER_CLASSES;

  /* ── Local State ────────────────────────────────────────────── */
  const [isEditing, setIsEditing] = useState(false);
  const [tempName, setTempName] = useState(data.name || "Task Auditor");

  /* ── Refs ───────────────────────────────────────────────────── */
  const contentRef = useRef<HTMLDivElement>(null);

  /* ── Custom Hooks ───────────────────────────────────────────── */
  const { width, height, startResize } = useGlobalChatNodeResize({
    id,
    initialWidth: data.width,
    initialHeight: data.height,
    updateNode,
  });

  useGlobalChatNodeScroll(contentRef);

  /* ── Callbacks ──────────────────────────────────────────────── */

  /** Persist the edited name and exit edit mode. */
  const handleNameSave = (): void => {
    updateNode(id, { name: tempName });
    setIsEditing(false);
  };

  /** Discard edit and revert to the stored name. */
  const handleCancelEdit = (): void => {
    setTempName(data.name || "Task Auditor");
    setIsEditing(false);
  };

  /** Enter name-edit mode. */
  const handleStartEdit = (): void => {
    setIsEditing(true);
  };

  /** Delete this node from the canvas. */
  const handleDelete = (): void => {
    deleteNode(id);
  };

  /** Select this node and open the side pane in the store. */
  const handleOpenPane = (): void => {
    setSelectedNodeId(id);

    const store = useWorkspaceStore.getState();
    const canvasContext = store.canvasContexts[tabId];
    if (canvasContext) {
      const updatedNodes = canvasContext.nodes.map((n) => ({
        ...n,
        selected: n.id === id,
      }));
      store.updateCanvasContext(tabId, { nodes: updatedNodes });
    }
  };

  /* ── Render ─────────────────────────────────────────────────── */
  const borderClass =
    STATUS_BORDER_CLASSES[nodeStatus] ?? STATUS_BORDER_CLASSES.idle;

  return (
    <div
      style={{ width: `${width}px`, height: `${height}px` }}
      className={`rounded-lg border bg-[var(--bg-sidebar)] text-[var(--text-normal)] overflow-hidden flex flex-col transition-[border-color,box-shadow] duration-300 shadow-lg relative ${borderClass}`}
    >
      <GlobalChatNodeHeader
        defaultName="Task Auditor"
        name={data.name}
        nodeStatus={nodeStatus}
        isEditing={isEditing}
        tempName={tempName}
        onTempNameChange={setTempName}
        onNameSave={handleNameSave}
        onCancelEdit={handleCancelEdit}
        onStartEdit={handleStartEdit}
        onDelete={handleDelete}
      />

      <GlobalChatNodeContent
        data={data}
        skills={skills}
        mcpServers={mcpServers}
        updateNode={updateNode}
        id={id}
        contentRef={contentRef}
      />

      <GlobalChatNodeFooter onOpenPane={handleOpenPane} />

      <GlobalChatNodeResizeHandle onStartResize={startResize} />
    </div>
  );
});
