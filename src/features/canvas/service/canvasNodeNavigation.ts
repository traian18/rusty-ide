export const CANVAS_NODE_FOCUS_EVENT = "rusty-canvas-node-focus";

export interface CanvasNodeFocusDetail {
  tabId: string;
  nodeId: string;
}

/**
 * Ask the mounted React Flow canvas to reveal one of its nodes.
 *
 * Keeping this as a small event contract lets toolbar controls, side panes,
 * and VFS views navigate without depending directly on a React Flow instance.
 */
export function focusCanvasNode(tabId: string, nodeId: string): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<CanvasNodeFocusDetail>(CANVAS_NODE_FOCUS_EVENT, {
    detail: { tabId, nodeId },
  }));
}
