/**
 * canvasHelpers.ts
 *
 * Pure utility functions used by the Rusty canvas components.
 * These helpers have no React or store dependencies.
 */

import type { Node, ReactFlowInstance } from "@xyflow/react";

/**
 * Returns the center position of the React Flow viewport in flow coordinates.
 *
 * Uses the canvas DOM element (id = `rf-canvas-${tabId}`) to calculate the
 * viewport center and converts it to flow coordinates.
 *
 * Falls back to `{ x: 300, y: 200 }` if the DOM element or RF instance is
 * unavailable.
 */
export function getCanvasCenter(
  rfInstance: ReactFlowInstance | null,
  tabId: string
): { x: number; y: number } {
  if (rfInstance) {
    const bounds = document.getElementById(`rf-canvas-${tabId}`)?.getBoundingClientRect();
    if (bounds) {
      const centerX = bounds.left + bounds.width / 2;
      const centerY = bounds.top + bounds.height / 2;
      return rfInstance.screenToFlowPosition({ x: centerX, y: centerY });
    }
  }
  return { x: 300, y: 200 };
}

/**
 * Converts a screen position (from a mouse/touch event) to flow coordinates.
 *
 * @returns Flow position or `null` if conversion fails.
 */
export function screenToFlowPosition(
  rfInstance: ReactFlowInstance | null,
  screenX: number,
  screenY: number
): { x: number; y: number } | null {
  if (!rfInstance) return null;
  return rfInstance.screenToFlowPosition({ x: screenX, y: screenY });
}

/**
 * Applies visual configuration overrides to nodes before passing them to React Flow.
 *
 * - Boundary nodes are non-selectable and non-draggable (zIndex: 0).
 * - Expanded task nodes (isMinimized === false) are brought to the foreground (zIndex: 1000).
 * - All other nodes receive a default zIndex of 10 (preserving any pre-set value).
 */
export function buildFlowNodes(nodes: Node[]): Node[] {
  return nodes.map((node) => {
    if (node.type === "boundaryNode") {
      return { ...node, selectable: false, draggable: false, zIndex: 0 };
    }
    if (node.type === "taskNode" && node.data?.isMinimized === false) {
      return { ...node, zIndex: 1000 };
    }
    return { ...node, zIndex: node.zIndex ?? 10 };
  });
}

/**
 * Computes the visual center position of a node, using measured dimensions
 * when available or falling back to defaults.
 */
export function getNodeCenter(
  node: Node,
  defaults: { width: number; height: number } = { width: 288, height: 120 }
): { x: number; y: number } {
  const width = node.measured?.width ?? defaults.width;
  const height = node.measured?.height ?? defaults.height;
  return {
    x: node.position.x + width / 2,
    y: node.position.y + height / 2,
  };
}
