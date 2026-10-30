import { useCallback, useRef, useMemo } from "react";
import { useWorkspaceStore } from "../../../store";
import type { Node } from "@xyflow/react";
import { isValidConnection, getPossibleConnection } from "../helpers/connectionHelpers";

interface CanvasConnectionsParams {
  tabId: string;
  nodes: Node[];
  edges: any[];
  selectedNodes: any[];
  rfInstance: any;
}

/** Connection gestures on the canvas: connect, drag-from-handle to create a context node, quick-connect two selected nodes. */
export function useCanvasConnections({ tabId, nodes, edges, selectedNodes, rfInstance }: CanvasConnectionsParams) {
  const connectionStartRef = useRef<any>(null);

  const onConnect = useCallback(
    (connection: any) => {
      useWorkspaceStore.getState().onConnectForTab(tabId, connection);
    },
    [tabId]
  );

  const onConnectStart = useCallback(
    (_: any, { nodeId, handleId, handleType }: any) => {
      connectionStartRef.current = { nodeId, handleId, handleType };
    },
    []
  );

  const onConnectEnd = useCallback(
    (event: any) => {
      if (!connectionStartRef.current) return;

      const target = event.target as Element;
      const isPane =
        target.classList.contains("react-flow__pane") ||
        target.closest(".react-flow__pane");

      if (isPane && rfInstance) {
        const { nodeId, handleId } = connectionStartRef.current;
        const startNode = nodes.find((n: { id: string }) => n.id === nodeId);

        if (
          startNode &&
          startNode.type === "taskNode" &&
          handleId?.startsWith("context-in")
        ) {
          const clientX = event.clientX || (event.touches?.[0]?.clientX);
          const clientY = event.clientY || (event.touches?.[0]?.clientY);

          if (clientX !== undefined && clientY !== undefined) {
            const projected = rfInstance.screenToFlowPosition({
              x: clientX,
              y: clientY,
            });
            useWorkspaceStore
              .getState()
              .addAndConnectContextNode(
                projected.x,
                projected.y,
                nodeId,
                handleId,
                tabId
              );
          }
        }
      }

      connectionStartRef.current = null;
    },
    [nodes, rfInstance, tabId]
  );

  /* ---- Connection helpers (derived from selected nodes) ---- */

  const possibleConnection = useMemo(() => {
    if (selectedNodes.length !== 2) return null;
    return getPossibleConnection(selectedNodes[0], selectedNodes[1], nodes, edges);
  }, [selectedNodes, nodes, edges]);

  const handleConnectSelected = useCallback(() => {
    if (possibleConnection) {
      useWorkspaceStore.getState().onConnectForTab(tabId, possibleConnection);
    }
  }, [possibleConnection, tabId]);

  /* ---- Validation (delegates to pure helper) ---- */

  const handleIsValidConnection = useCallback(
    (connection: any) => isValidConnection(connection, nodes),
    [nodes]
  );

  return { onConnect, onConnectStart, onConnectEnd, possibleConnection, handleConnectSelected, handleIsValidConnection };
}
