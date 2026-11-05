import { useRef } from "react";
import { useWorkspaceStore } from "../../../../store";
import { VfsRegistry } from "../../../canvas";
import { editorClient } from "../../client";
import { modelUriFor, staysOpen, type FileTabData } from "./fileLocation";

const SAVE_DELAY_MS = 500;

interface PendingSave {
  value: string;
  timer: ReturnType<typeof setTimeout>;
  /** Each tab waiting on this save, with what to run once it reached the disk. */
  onDiskSaved: Map<string, () => void>;
}

/** Per file, not per tab: both tabs of a file schedule every edit, which must
 * become one write, and the write must outlive whichever tab closes first. */
const pendingSaves = new Map<string, PendingSave>();

/** Text typed into the file but not on disk yet, because its save is waiting,
 * running or failed; a tab opening now must start from it and a reload must leave it. */
export function unsavedFileText(modelUri: string): string | undefined {
  return pendingSaves.get(modelUri)?.value;
}

export interface AutoSave {
  /** Saves `value` once edits pause, replacing a save still waiting. */
  schedule: (value: string) => void;
  cancel: () => void;
}

/** Saves edits to the canvas VFS, or to disk; a disk save refreshes the git
 * changes list and then calls `onDiskSaved`. */
export function useAutoSave(tab: FileTabData, canvasTabId: string | undefined, onDiskSaved: () => void): AutoSave {
  const onDiskSavedRef = useRef(onDiskSaved);
  onDiskSavedRef.current = onDiskSaved;
  const modelUri = modelUriFor(tab.path, tab.vfsTabId);

  const save = async (pending: PendingSave) => {
    try {
      if (canvasTabId) {
        await VfsRegistry.getOrCreate(canvasTabId).writeFile(tab.path, pending.value);
        console.log(`FileTab saved to VFS (${canvasTabId}): ${tab.title}`);
      } else {
        await editorClient.writeFile(tab.path, pending.value);
        console.log(`FileTab auto-saved: ${tab.title}`);
      }
      if (pendingSaves.get(modelUri) === pending) pendingSaves.delete(modelUri);
      if (canvasTabId) return;
      useWorkspaceStore.getState().loadGitStatus(); // Reload git changes list
      pending.onDiskSaved.forEach((run) => run());
    } catch (err) {
      console.error("FileTab save failed:", err);
    }
  };

  return {
    schedule: (value) => {
      const previous = pendingSaves.get(modelUri);
      if (previous) clearTimeout(previous.timer);
      const waiting = previous?.onDiskSaved ?? new Map<string, () => void>();
      waiting.set(tab.id, () => onDiskSavedRef.current());
      const pending: PendingSave = { value, timer: setTimeout(() => void save(pending), SAVE_DELAY_MS), onDiskSaved: waiting };
      pendingSaves.set(modelUri, pending);
    },
    cancel: () => {
      const pending = pendingSaves.get(modelUri);
      if (!pending || staysOpen(tab.id, modelUri)) return;
      clearTimeout(pending.timer);
      pendingSaves.delete(modelUri);
    },
  };
}
