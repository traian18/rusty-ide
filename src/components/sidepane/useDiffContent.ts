import { useState, useEffect, useRef, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { VfsRegistry } from "../../services/vfs";

export const useDiffContent = (
  selectedNodeId: string | null,
  activeDiffFile: string,
  nodeStatus: string,
  tabId?: string,
  originalSnapshot?: string,
  generatedSnapshot?: string
) => {
  const [originalCode, setOriginalCode] = useState("// Loading original content...");
  const [modifiedCode, setModifiedCode] = useState("// Loading modified content...");
  const [isLoading, setIsLoading] = useState(false);
  const loadingFileRef = useRef<string | null>(null);
  const prevNodeStatusRef = useRef<string>("");

  const refreshContent = useCallback(async () => {
    if (!selectedNodeId || !activeDiffFile) return;

    setIsLoading(true);
    loadingFileRef.current = activeDiffFile;

    try {
      console.log(`SidePane [fetchDiffContent] loading paths`, { activeDiffFile });
      const modified: string = generatedSnapshot !== undefined
        ? generatedSnapshot
        : await VfsRegistry.getOrCreate(tabId).readFile(activeDiffFile);

      let original = originalSnapshot;
      if (original === undefined) {
        try {
          original = await invoke("read_file_disk", { path: activeDiffFile });
        } catch (diskErr) {
          console.log(`SidePane [fetchDiffContent] File not on disk yet (treating as new file)`);
          original = "";
        }
      }

      setOriginalCode(original ?? "");
      setModifiedCode(modified);
      setIsLoading(false);
    } catch (e: any) {
      console.error("SidePane [fetchDiffContent] failed to read content:", e);
      setOriginalCode(`// Error reading file: ${e.message}`);
      setModifiedCode(`// Error reading file: ${e.message}`);
      setIsLoading(false);
    }
  }, [selectedNodeId, activeDiffFile, tabId, originalSnapshot, generatedSnapshot]);

  useEffect(() => {
    let active = true;
    const fetchDiffContent = async () => {
      if (!selectedNodeId || !activeDiffFile) return;

      setIsLoading(true);
      loadingFileRef.current = activeDiffFile;

      try {
        console.log(`SidePane [fetchDiffContent] loading paths`, { activeDiffFile });
        const modified: string = generatedSnapshot !== undefined
          ? generatedSnapshot
          : await VfsRegistry.getOrCreate(tabId).readFile(activeDiffFile);

        let original = originalSnapshot;
        if (original === undefined) {
          try {
            original = await invoke("read_file_disk", { path: activeDiffFile });
          } catch (diskErr) {
            console.log(`SidePane [fetchDiffContent] File not on disk yet (treating as new file)`);
            original = "";
          }
        }

        if (active && loadingFileRef.current === activeDiffFile) {
          setOriginalCode(original ?? "");
          setModifiedCode(modified);
          setIsLoading(false);
        }
      } catch (e: any) {
        console.error("SidePane [fetchDiffContent] failed to read content:", e);
        if (active && loadingFileRef.current === activeDiffFile) {
          setOriginalCode(`// Error reading file: ${e.message}`);
          setModifiedCode(`// Error reading file: ${e.message}`);
          setIsLoading(false);
        }
      }
    };

    fetchDiffContent();
    return () => {
      active = false;
    };
  }, [selectedNodeId, activeDiffFile, nodeStatus, tabId, originalSnapshot, generatedSnapshot]);

  useEffect(() => {
    if (prevNodeStatusRef.current === "running" && nodeStatus === "success") {
      console.log(`SidePane [fetchDiffContent] execution completed, refreshing content`);
      refreshContent();
    }
    prevNodeStatusRef.current = nodeStatus;
  }, [nodeStatus, refreshContent]);

  return { originalCode, modifiedCode, isLoading, refreshContent };
};
