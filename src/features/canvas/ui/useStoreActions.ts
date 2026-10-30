import { useMemo } from "react";
import { useWorkspaceStore } from "../../../store";

/**
 * Extracts store action creators into a single memoized object so they
 * can be passed to child components without repetitive selectors.
 */
export function useStoreActions() {
  const addContextNode = useWorkspaceStore((state) => state.addContextNode);
  const addTaskNode = useWorkspaceStore((state) => state.addTaskNode);
  const addGlobalChatNode = useWorkspaceStore((state) => state.addGlobalChatNode);
  const addMcpNode = useWorkspaceStore((state) => state.addMcpNode);
  const addStickyNode = useWorkspaceStore((state) => state.addStickyNode);
  const addBoundaryNode = useWorkspaceStore((state) => state.addBoundaryNode);

  return useMemo(
    () => ({
      addContextNode,
      addTaskNode,
      addGlobalChatNode,
      addMcpNode,
      addStickyNode,
      addBoundaryNode,
    }),
    [
      addContextNode,
      addTaskNode,
      addGlobalChatNode,
      addMcpNode,
      addStickyNode,
      addBoundaryNode,
    ]
  );
}

/* ================================================================ */
/*  Floating Connect Button                                          */
/* ================================================================ */
