import { useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useWorkspaceStore } from "../../../store";
import { VfsRegistry } from "../../../services/vfs";
import type { FileTabData } from "./fileLocation";

const SAVE_DELAY_MS = 500;

export interface AutoSave {
  /** Saves `value` once edits pause, replacing a save still waiting. */
  schedule: (value: string) => void;
  cancel: () => void;
}

/** Saves edits to the canvas VFS, or to disk; a disk save refreshes the git
 * changes list and then calls `onDiskSaved`. */
export function useAutoSave(tab: FileTabData, canvasTabId: string | undefined, onDiskSaved: () => void): AutoSave {
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const save = async (value: string) => {
    try {
      if (canvasTabId) {
        await VfsRegistry.getOrCreate(canvasTabId).writeFile(tab.path, value);
        console.log(`FileTab saved to VFS (${canvasTabId}): ${tab.title}`);
      } else {
        await invoke("write_file_disk", { path: tab.path, content: value });
        console.log(`FileTab auto-saved: ${tab.title}`);
        useWorkspaceStore.getState().loadGitStatus(); // Reload git changes list
        onDiskSaved();
      }
    } catch (err) {
      console.error("FileTab save failed:", err);
    }
  };

  const cancel = () => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
  };

  return {
    schedule: (value) => {
      cancel();
      timeoutRef.current = setTimeout(() => save(value), SAVE_DELAY_MS);
    },
    cancel,
  };
}
