import { useEffect, useRef, useState } from "react";

/** Reads only the task node's persisted before/after snapshots. */
export const useDiffContent = (
  selectedNodeId: string | null,
  activeDiffFile: string,
  nodeStatus: string,
  _tabId?: string,
  originalSnapshot?: string,
  generatedSnapshot?: string
) => {
  const [originalCode, setOriginalCode] = useState("");
  const [modifiedCode, setModifiedCode] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const previousStatus = useRef("");

  const refreshContent = () => {
    if (!selectedNodeId || !activeDiffFile) return;
    setIsLoading(true);
    setOriginalCode(originalSnapshot ?? "");
    setModifiedCode(generatedSnapshot ?? "");
    setIsLoading(false);
  };

  useEffect(refreshContent, [selectedNodeId, activeDiffFile, originalSnapshot, generatedSnapshot]);
  useEffect(() => {
    if (previousStatus.current === "running" && nodeStatus === "success") refreshContent();
    previousStatus.current = nodeStatus;
  }, [nodeStatus]);

  return { originalCode, modifiedCode, isLoading, refreshContent };
};
