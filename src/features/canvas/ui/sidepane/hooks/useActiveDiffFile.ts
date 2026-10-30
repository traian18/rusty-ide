/**
 * useActiveDiffFile.ts
 *
 * Automatically selects which file should be shown in the diff viewer
 * whenever the selected node or its modified files change.
 */

import { useEffect } from "react";

/**
 * Updates `activeDiffFile` to the first modified file when the selected node
 * or its file list changes.
 *
 * - For context nodes: uses `selectedNode.data.path` (unless it is a directory).
 * - For task nodes: uses the first entry in `modifiedFiles`.
 *
 * @param selectedNode      - The selected node object (may be undefined).
 * @param modifiedFiles     - List of file paths modified by the node.
 * @param activeDiffFile    - The currently active diff file path.
 * @param setActiveDiffFile - State setter for the active diff file.
 */
export function useActiveDiffFile(
  selectedNode: any,
  modifiedFiles: string[],
  activeDiffFile: string,
  setActiveDiffFile: (file: string) => void
): void {
  useEffect(() => {
    if (!selectedNode) return;

    if (selectedNode.type === "contextNode") {
      const path = selectedNode.data.path as string;
      if (path && !selectedNode.data.isDir && activeDiffFile !== path) {
        setActiveDiffFile(path);
      }
    } else if (selectedNode.type === "taskNode") {
      if (modifiedFiles.length > 0) {
        if (!modifiedFiles.includes(activeDiffFile)) {
          setActiveDiffFile(modifiedFiles[0]);
        }
      } else if (activeDiffFile !== "") {
        setActiveDiffFile("");
      }
    }
    // setActiveDiffFile is a stable useState setter and intentionally omitted.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedNode?.id, modifiedFiles, activeDiffFile]);
}
