/**
 * useEdgeDiff Hook
 * 
 * Manages the logic for loading conflict details and file diffs for a selected edge.
 * It coordinates calculations of conflict descriptions and uses Tauri VFS/Disk APIs
 * to fetch original and modified content for file comparisons.
 */

import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { VfsRegistry } from "../../services/vfs";

export const useEdgeDiff = (
  edge: any,
  sourceNode: any,
  targetNode: any,
  sourceModifiedFiles: string[],
  tabId?: string
) => {
  const [conflictDetails, setConflictDetails] = useState<string>("");
  const [originalCode, setOriginalCode] = useState("// No conflict data loaded");
  const [modifiedCode, setModifiedCode] = useState("// No conflict data loaded");
  const [diffFile, setDiffFile] = useState("");

  const loadDiffContent = async (filePath: string) => {
    try {
      const vfs = VfsRegistry.getOrCreate(tabId);
      const modified: string = await vfs.readFile(filePath);
      let original = "";
      try {
        original = await invoke("read_file_disk", { path: filePath });
      } catch {
        original = "";
      }
      setOriginalCode(original);
      setModifiedCode(modified);
    } catch (e: any) {
      setOriginalCode(`// Error: ${e.message}`);
      setModifiedCode(`// Error: ${e.message}`);
    }
  };

  useEffect(() => {
    if (!edge || !sourceNode || !targetNode) return;

    const sourceName = (sourceNode.data as any).name || sourceNode.id;
    const targetName = (targetNode.data as any).name || targetNode.id;
    const files = sourceModifiedFiles.join(", ") || "none";

    setConflictDetails(
      `Source: ${sourceName}\nTarget: ${targetName}\nModified files: ${files}\n\nThe reconciliation engine detected potential conflicts between the output of the source task and the specifications of the target task.`
    );

    if (sourceModifiedFiles.length > 0) {
      setDiffFile(sourceModifiedFiles[0]);
      loadDiffContent(sourceModifiedFiles[0]);
    }
  }, [edge?.id, sourceNode?.id, targetNode?.id, sourceModifiedFiles]);

  return {
    conflictDetails,
    originalCode,
    modifiedCode,
    diffFile,
    setDiffFile,
    loadDiffContent
  };
};
