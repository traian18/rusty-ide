import { useWorkspaceStore } from "../../../store";
import { CANVAS_NODE_FOCUS_EVENT, type CanvasNodeFocusDetail } from "../service/canvasNodeNavigation";

/**
 * Listens for CANVAS_NODE_FOCUS_EVENT and animates the viewport to
 * center on the target node.
 */
export function registerNodeFocusEffect(
  tabId: string,
  nodes: any[],
  rfInstance: any
): () => void {
  const handleNodeFocus = (event: Event) => {
    const detail = (event as CustomEvent<CanvasNodeFocusDetail>).detail;
    if (detail?.tabId !== tabId || !rfInstance) return;
    const targetNode = nodes.find((node: { id: string }) => node.id === detail.nodeId);
    if (!targetNode) return;
    void rfInstance.fitView({
      nodes: [targetNode],
      padding: targetNode.type === "boundaryNode" ? 0.18 : 0.4,
      minZoom: 0.15,
      maxZoom: 1.2,
      duration: 450,
    });
  };

  window.addEventListener(CANVAS_NODE_FOCUS_EVENT, handleNodeFocus);
  return () =>
    window.removeEventListener(CANVAS_NODE_FOCUS_EVENT, handleNodeFocus);
}

/**
 * Registers keyboard shortcuts for undo (Cmd+Z / Ctrl+Z) and redo
 * (Cmd+Shift+Z / Ctrl+Shift+Z) on the canvas.
 */
export function registerUndoRedoShortcut(tabId: string): () => void {
  const handleKeyDown = (e: KeyboardEvent) => {
    if (!e.metaKey && !e.ctrlKey) return;
    if (e.key !== "z" && e.key !== "Z") return;

    // Don't intercept when typing in input fields
    const active = document.activeElement as HTMLElement | null;
    if (
      active &&
      (active.tagName === "INPUT" ||
        active.tagName === "TEXTAREA" ||
        active.isContentEditable)
    )
      return;

    e.preventDefault();
    if (e.shiftKey) {
      useWorkspaceStore.getState().redoCanvasTab(tabId);
    } else {
      useWorkspaceStore.getState().undoCanvasTab(tabId);
    }
  };

  window.addEventListener("keydown", handleKeyDown);
  return () => window.removeEventListener("keydown", handleKeyDown);
}

/* ================================================================ */
/*  Extracted Helper Functions                                       */
/* ================================================================ */

/**
 * Computes the visual center of a node, using measured dimensions
 * or sensible defaults for each node type.
 */
export function getNodeCenterLocal(node: any): { x: number; y: number } {
  const defaults: Record<string, { width: number; height: number }> = {
    taskNode: { width: 320, height: 120 },
    default: { width: 288, height: 120 },
  };
  const typeDefaults = defaults[node.type] || defaults.default;
  const width = node.measured?.width ?? typeDefaults.width;
  const height = node.measured?.height ?? typeDefaults.height;
  return {
    x: node.position.x + width / 2,
    y: node.position.y + height / 2,
  };
}
