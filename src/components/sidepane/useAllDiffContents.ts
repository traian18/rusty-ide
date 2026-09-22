import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { VfsRegistry } from "../../services/vfs";

export interface DiffFileContent {
  path: string;
  originalCode: string;
  modifiedCode: string;
}

export const useAllDiffContents = (
  selectedNodeId: string | null,
  modifiedFiles: string[],
  nodeStatus: string,
  tabId?: string
) => {
  const [diffContents, setDiffContents] = useState<DiffFileContent[]>([]);

  useEffect(() => {
    let active = true;

    const fetchAllContents = async () => {
      if (!selectedNodeId || modifiedFiles.length === 0) {
        setDiffContents([]);
        return;
      }

      const results: DiffFileContent[] = [];

      for (const filePath of modifiedFiles) {
        try {
          const modified: string = await VfsRegistry.getOrCreate(tabId).readFile(filePath);

          let original = "";
          try {
            original = await invoke("read_file_disk", { path: filePath });
          } catch (diskErr) {
            original = "";
          }

          results.push({ path: filePath, originalCode: original, modifiedCode: modified });
        } catch (e: any) {
          results.push({
            path: filePath,
            originalCode: `// Error reading file: ${e.message}`,
            modifiedCode: `// Error reading file: ${e.message}`
          });
        }
      }

      if (active) {
        setDiffContents(results);
      }
    };

    fetchAllContents();

    return () => {
      active = false;
    };
  }, [selectedNodeId, modifiedFiles.join(","), nodeStatus]);

  return { diffContents };
};