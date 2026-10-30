import { useCallback, useEffect, useState } from "react";
import { applyNodeChanges, type Node, type NodeChange } from "@xyflow/react";

/** Local node state that follows `derived`, so drags render smoothly. */
export function useFollowingNodes<T extends Node>(derived: T[]) {
  const [nodes, setNodes] = useState<T[]>(derived);
  useEffect(() => setNodes(derived), [derived]);
  const onNodesChange = useCallback(
    (changes: NodeChange<T>[]) =>
      setNodes((current) =>
        // Removal and selection belong to the documents and the inspector.
        applyNodeChanges(
          changes.filter((change) => change.type === "position" || change.type === "dimensions"),
          current,
        ),
      ),
    [],
  );
  return { nodes, onNodesChange };
}
