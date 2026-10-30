import { useState, useCallback } from "react";
import { useWorkspaceStore } from "../../../store";
import { notify } from "../../notifications";
import { canvasFileService } from "../services/canvasFileService";

/** Save-pipeline modal state and the save action for one canvas tab. */
export function useSavePipeline(tab: { id: string; title: string }) {
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [saveTitle, setSaveTitle] = useState(tab.title);

  /** Opens the save modal. */
  const handleSavePipeline = useCallback(() => {
    setShowSaveModal(true);
  }, []);

  /** Confirms the save action from the modal. */
  const confirmSavePipeline = useCallback(async () => {
    if (!saveTitle.trim()) {
      notify("Invalid input", "Please enter a valid title", "info");
      return;
    }
    try {
      const filePath = await canvasFileService.saveCanvas(tab.id, saveTitle);
      useWorkspaceStore.getState().updateTab(tab.id, { title: saveTitle });
      useWorkspaceStore
        .getState()
        .updateCanvasContext(tab.id, { hasBeenSaved: true });
      setShowSaveModal(false);
      notify("Saved", `Pipeline saved to: ${filePath}`, "success");
    } catch (e: any) {
      notify("Save failed", `Error saving pipeline: ${e.message || e}`, "error");
    }
  }, [saveTitle, tab.id]);

  return { showSaveModal, setShowSaveModal, saveTitle, setSaveTitle, handleSavePipeline, confirmSavePipeline };
}
