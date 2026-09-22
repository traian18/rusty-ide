/**
 * useActiveTabDefault.ts
 *
 * Sets the default active tab whenever the selected node changes: always
 * "chat", regardless of node type. Previously defaulted to "description"
 * for task nodes and "diff" for context/other nodes -- changed so that
 * opening any node's pane lands on its chat first, matching SidePane.tsx's
 * new full-screen-by-default behavior (the rail makes every other section
 * one click away regardless of which one opens first, so there's no longer
 * a reason for the default to vary by node type).
 */

import { useEffect } from "react";

export type SidePaneTab = "description" | "diff" | "chat" | "console" | "vfs";

/**
 * Resets `activeTab` to "chat" when the selected node changes.
 *
 * @param selectedNode - The selected node object (may be undefined).
 * @param setActiveTab - State setter for the active tab.
 */
export function useActiveTabDefault(
  selectedNode: any,
  setActiveTab: (tab: SidePaneTab) => void
): void {
  useEffect(() => {
    if (!selectedNode) return;
    setActiveTab("chat");
    // setActiveTab is a stable useState setter and intentionally omitted.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedNode?.id, selectedNode?.type]);
}
