import React, { useState, useCallback } from "react";
import { type ContextMenuPosition } from "./components/RustyTabContextMenu";
import { useStoreActions } from "./useStoreActions";

interface CanvasNodeCreationParams {
  tabId: string;
  rfInstance: any;
  storeActions: ReturnType<typeof useStoreActions>;
}

/** Context menu, double-click, file-drop and menu-driven node creation on the canvas. */
export function useCanvasNodeCreation({ tabId, rfInstance, storeActions }: CanvasNodeCreationParams) {
  const [contextMenu, setContextMenu] = useState<ContextMenuPosition | null>(null);

  const onPaneContextMenu = useCallback(
    (event: any) => {
      event.preventDefault();
      const bounds = document
        .getElementById(`rf-canvas-${tabId}`)
        ?.getBoundingClientRect();
      if (bounds) {
        setContextMenu({
          x: event.clientX - bounds.left,
          y: event.clientY - bounds.top,
          screenX: event.clientX,
          screenY: event.clientY,
        });
      }
    },
    [tabId]
  );

  const onNodeContextMenu = useCallback(
    (event: any, node: any) => {
      if (node.type !== "boundaryNode") return;
      event.preventDefault();
      const bounds = document
        .getElementById(`rf-canvas-${tabId}`)
        ?.getBoundingClientRect();
      if (bounds) {
        setContextMenu({
          x: event.clientX - bounds.left,
          y: event.clientY - bounds.top,
          screenX: event.clientX,
          screenY: event.clientY,
        });
      }
    },
    [tabId]
  );

  const onPaneDoubleClick = useCallback(
    (event: React.MouseEvent) => {
      const target = event.target as HTMLElement;
      if (!target.classList.contains("react-flow__pane")) return;

      const bounds = document
        .getElementById(`rf-canvas-${tabId}`)
        ?.getBoundingClientRect();
      if (!bounds || !rfInstance) return;

      const position = rfInstance.screenToFlowPosition({
        x: event.clientX,
        y: event.clientY,
      });
      storeActions.addTaskNode(position.x - 75, position.y - 30, tabId);
    },
    [rfInstance, storeActions, tabId]
  );

  const onDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
  }, []);

  const onDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();
      const rawData = event.dataTransfer.getData("text/plain");
      if (!rawData) return;

      try {
        const dragData = JSON.parse(rawData);
        if (!dragData || !dragData.path || !dragData.name) return;

        let position = { x: event.clientX, y: event.clientY };
        if (rfInstance) {
          position = rfInstance.screenToFlowPosition({
            x: event.clientX,
            y: event.clientY,
          });
        } else {
          const bounds = document
            .getElementById(`rf-canvas-${tabId}`)
            ?.getBoundingClientRect();
          if (bounds) {
            position = {
              x: event.clientX - bounds.left,
              y: event.clientY - bounds.top,
            };
          }
        }

        storeActions.addContextNode(
          position.x - 75,
          position.y - 30,
          {
            path: dragData.path,
            name: dragData.name,
            isDir: dragData.isDir,
          },
          tabId
        );
      } catch (err) {
        console.log("App canvas drop: Not a JSON string.", err);
      }
    },
    [storeActions, rfInstance, tabId]
  );

  /* ---- Node creation from context menu ---- */

  const handleAddNodeFromContextMenu = useCallback(
    (type: "task" | "context" | "sticky" | "boundary") => {
      if (!contextMenu || !rfInstance) return;

      const flowPosition = rfInstance.screenToFlowPosition({
        x: contextMenu.screenX,
        y: contextMenu.screenY,
      });

      switch (type) {
        case "task":
          storeActions.addTaskNode(flowPosition.x - 75, flowPosition.y - 30, tabId);
          break;
        case "context":
          storeActions.addContextNode(flowPosition.x - 75, flowPosition.y - 30, undefined, tabId);
          break;
        case "sticky":
          storeActions.addStickyNode(flowPosition.x - 100, flowPosition.y - 75, tabId);
          break;
        case "boundary":
          storeActions.addBoundaryNode(flowPosition.x - 150, flowPosition.y - 100, tabId);
          break;
      }
      setContextMenu(null);
    },
    [contextMenu, rfInstance, storeActions, tabId]
  );

  return {
    contextMenu,
    setContextMenu,
    onPaneContextMenu,
    onNodeContextMenu,
    onPaneDoubleClick,
    onDragOver,
    onDrop,
    handleAddNodeFromContextMenu,
  };
}
